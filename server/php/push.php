<?php
/**
 * Pet Hatch alerts for PHP hosting ("Pip is calling!"), sent by web push, only to players who turn them on in
 * Settings.
 *
 * The game works out from its own simulation when its egg or pet will next need the player (src/sim/alerts.ts)
 * and sends those times here whenever it's closed; opening it again clears them. A cron job runs the tick every
 * minute, which sends whatever is due. Kept per phone: its push address and keys, the alert times and their kind
 * (call, egg, hatch), and when it last checked in. No names, no save, nothing else about the pet; the message
 * only says the kind, and the game on the phone puts the words to it.
 *
 *   POST push.php  {"sub": {"endpoint", "keys": {"p256dh", "auth"}}, "alerts": [[time ms, kind], …]}  → 204
 *   POST push.php  {"sub": {"endpoint"}, "off": true}                                       → 204, forgotten
 *   php push.php tick                    the cron job, from the command line; or over the web:
 *   GET  push.php?tick&token=…           (the stats dashboard's token)
 *
 * The keys (VAPID) come from PETHATCH_PUSH_PUBLIC_KEY and PETHATCH_PUSH_PRIVATE_KEY, or from push-key.php, best
 * kept in a pet-hatch-private folder outside the web folder (see private_file() in common.php). npm run deploy
 * writes it, and push.json (which tells the game alerts exist) for the web folder. Data lives in
 * the relay's data folder (relay-data/, or PETHATCH_DATA_DIR). Needs PHP 8.1 or newer with openssl, and curl or
 * allow_url_fopen.
 */

declare(strict_types=1);

require_once __DIR__ . '/common.php';
require_once __DIR__ . '/webpush.php';

const KINDS = ['call', 'egg', 'hatch'];
const MAX_BODY = 2048;
/** Alerts kept per phone (the game sends the next day's at most, a gap apart). */
const MAX_ALERTS = 16;
/** How far ahead an alert may be. */
const AHEAD_MS = 3 * 24 * 3600_000;
/** An alert this late (the cron job stopped for a while) isn't sent any more: the call is over by then. */
const LATE_MS = 30 * 60_000;
/** Phones that haven't checked in for this long are forgotten. */
const IDLE_MS = 30 * 24 * 3600_000;
const MAX_PHONES = 20_000;
/** Phones one visitor (IP address; IPv6 by /64) may sign up: a household's, not someone filling the disk. */
const MAX_PHONES_PER_VISITOR = 20;
/** How long a push service keeps trying a message: as long as a call lasts. */
const TTL_S = 1800;
const DATA_FILE = 'push-alerts.php';
ini_set('display_errors', '0');

function fail(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message, "\n";
    exit;
}

/** @return array{public: string, private: string}|null */
function push_keys(): ?array
{
    $public = getenv('PETHATCH_PUSH_PUBLIC_KEY') ?: null;
    $private = getenv('PETHATCH_PUSH_PRIVATE_KEY') ?: null;
    $file = $public && $private ? null : private_file('push-key.php');
    if ($file) {
        $keys = include $file;
        [$public, $private] = [$keys['public'] ?? null, $keys['private'] ?? null];
    }
    $public = is_string($public) ? b64url_decode($public) : null;
    $private = is_string($private) ? b64url_decode($private) : null;
    return $public && $private && strlen($public) === 65 && strlen($private) === 32
        ? ['public' => $public, 'private' => $private] : null;
}

function now_ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

/** Only the tests may name a push service of their own. */
function test_origin(): ?string
{
    return getenv('PETHATCH_PUSH_TEST_ORIGIN') ?: null;
}

// ---------- signing up and updating ----------

function update(array $keys): never
{
    $raw = (string) file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if (strlen($raw) > MAX_BODY) fail(413, 'Too big.');
    $in = json_decode($raw, true);
    $endpoint = $in['sub']['endpoint'] ?? null;
    if (!is_string($endpoint) || !is_push_endpoint($endpoint, test_origin())) fail(400, 'Not a push address.');
    $id = substr(hash('sha256', $endpoint), 0, 24);
    $now = now_ms();

    if (($in['off'] ?? false) === true) {
        with_data(DATA_FILE, function (mixed &$d) use ($id) {
            unset($d['phones'][$id]);
        });
        http_response_code(204);
        exit;
    }

    $p256dh = b64url_decode((string) ($in['sub']['keys']['p256dh'] ?? ''));
    $auth = b64url_decode((string) ($in['sub']['keys']['auth'] ?? ''));
    if (!$p256dh || strlen($p256dh) !== 65 || $p256dh[0] !== "\x04" || !$auth || strlen($auth) !== 16) {
        fail(400, 'Bad keys.');
    }
    $alerts = $in['alerts'] ?? null;
    if (!is_array($alerts) || !array_is_list($alerts) || count($alerts) > MAX_ALERTS) fail(400, 'Bad alerts.');
    foreach ($alerts as $a) {
        if (!is_array($a) || count($a) !== 2 || !is_int($a[0]) || !in_array($a[1], KINDS, true)
            || $a[0] < $now - LATE_MS || $a[0] > $now + AHEAD_MS) {
            fail(400, 'Bad alerts.');
        }
    }
    usort($alerts, fn($x, $y) => $x[0] <=> $y[0]);
    // Who sends the messages, for the push services: this site, by its name. Push needs HTTPS, so a real game is
    // always reached by name; an address like 127.0.0.1 (only ever a test) isn't kept.
    $host = preg_replace('/:\d+$/', '', strtolower((string) ($_SERVER['HTTP_HOST'] ?? '')));
    $site = preg_match('/^(?=.*[a-z])[a-z0-9.-]{1,253}$/', $host) ? "https://$host" : null;
    $by = visitor_hash(hash('sha256', 'push|' . $keys['private']));

    $ok = with_data(DATA_FILE, function (mixed &$d) use ($id, $endpoint, $p256dh, $auth, $alerts, $site, $by, $now) {
        if (!is_array($d)) $d = ['phones' => []];
        forget_idle($d, $now);
        if (!isset($d['phones'][$id])) {
            if (count($d['phones']) >= MAX_PHONES) return false;
            $mine = count(array_filter($d['phones'], fn($p) => $p['by'] === $by));
            if ($mine >= MAX_PHONES_PER_VISITOR) return false;
        }
        $d['phones'][$id] = [
            'endpoint' => $endpoint,
            'p256dh' => b64url_encode($p256dh),
            'auth' => b64url_encode($auth),
            'site' => $site ?? $d['phones'][$id]['site'] ?? null,
            'by' => $by,
            'alerts' => $alerts,
            'seen' => $now,
        ];
        return true;
    });
    if (!$ok) fail(429, 'Too many phones.');
    http_response_code(204);
    exit;
}

function forget_idle(array &$d, int $now): void
{
    $d['phones'] = array_filter($d['phones'] ?? [], fn($p) => $now - $p['seen'] < IDLE_MS);
}

// ---------- the tick ----------

/**
 * Send every alert that is due. The due ones are taken out of the list first, so a slow push service or a tick
 * that overlaps the next never sends one twice; phones whose push address is gone (404, 410) are forgotten.
 * Returns what happened, for the cron job's log.
 */
function tick(array $keys): string
{
    $now = now_ms();
    $due = with_data(DATA_FILE, function (mixed &$d) use ($now) {
        if (!is_array($d)) return [];
        forget_idle($d, $now);
        $due = [];
        foreach ($d['phones'] as $id => &$phone) {
            $late = array_filter($phone['alerts'], fn($a) => $a[0] <= $now);
            if (!$late) continue;
            $phone['alerts'] = array_values(array_filter($phone['alerts'], fn($a) => $a[0] > $now));
            // Several at once (the cron job paused): only the latest still matters, if it isn't over yet.
            $last = end($late);
            if ($now - $last[0] <= LATE_MS) $due[$id] = $phone + ['kind' => $last[1], 'at' => $last[0]];
        }
        return $due;
    });

    [$sent, $failed, $gone] = [0, 0, []];
    foreach ($due as $id => $phone) {
        try {
            $body = push_encrypt(json_encode(['kind' => $phone['kind'], 'at' => $phone['at']]),
                b64url_decode($phone['p256dh']), b64url_decode($phone['auth']));
            $status = push_send($phone['endpoint'], $body, [
                'Authorization' => vapid_header($phone['endpoint'], $phone['site'] ?? 'https://localhost', $keys, intdiv($now, 1000)),
                'TTL' => (string) TTL_S,
                'Urgency' => 'high',
                // A newer alert replaces an older one the phone hasn't received yet.
                'Topic' => 'pet',
            ]);
        } catch (RuntimeException $e) {
            error_log('Pet Hatch alerts: ' . $e->getMessage());
            $status = 0;
        }
        if ($status >= 200 && $status < 300) $sent++;
        elseif ($status === 404 || $status === 410) $gone[] = $id;
        else $failed++;
    }
    if ($gone) {
        with_data(DATA_FILE, function (mixed &$d) use ($gone) {
            foreach ($gone as $id) unset($d['phones'][$id]);
        });
    }
    return "sent $sent, failed $failed, gone " . count($gone);
}

// ---------- requests ----------

$keys = push_keys();
if (PHP_SAPI === 'cli') {
    if (($argv[1] ?? '') !== 'tick') {
        fwrite(STDERR, "Usage: php push.php tick\n");
        exit(1);
    }
    if (!$keys) {
        fwrite(STDERR, "No push keys: upload push-key.php to pet-hatch-private/ (or set PETHATCH_PUSH_PUBLIC_KEY and PETHATCH_PUSH_PRIVATE_KEY).\n");
        exit(1);
    }
    echo tick($keys), "\n";
    exit;
}
header('Cache-Control: no-store');
if (!$keys) fail(404, 'Alerts are off: no push keys.');
try {
    if (isset($_GET['tick'])) {
        $token = dashboard_token();
        if (!$token || !is_string($_GET['token'] ?? null) || !hash_equals($token, $_GET['token'])) fail(403, 'Wrong token.');
        header('Content-Type: text/plain; charset=utf-8');
        echo tick($keys), "\n";
        exit;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') update($keys);
    fail(405, 'POST alerts, or GET ?tick&token=….');
} catch (DataUnavailable) {
    fail(503, 'The data folder isn’t writable.');
}
