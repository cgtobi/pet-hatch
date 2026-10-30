<?php
/**
 * Pet Hatch relay for PHP hosting. Does what server/relay.mjs does (rooms for live battles and the dojo's
 * matchmaking) over plain HTTP instead of WebSockets, so it runs on ordinary shared web hosting: no daemon,
 * no database, just this file next to the game and a folder it may write to (relay-data/, created on first use).
 *
 * The game posts JSON and picks up messages by long polling:
 *   join  { room, role }  – enter a battle room as host or guest
 *   dojo  { code, id }    – wait in the dojo with this battle code
 *   send  { id, msgs }    – forward messages to the other player in the room
 *   poll  { id, after }   – messages newer than `after`, waiting up to POLL_WAIT_MS for some
 *   leave { id, msgs? }   – last messages, then leave
 * Replies: { id?, msgs: [[seq, text], …], closed?, gone? }. A connection that stops polling counts as
 * gone, as if its socket had closed. Messages are forwarded as they are (except any that pretend to come from the
 * relay itself, which are dropped); the relay knows nothing about battles.
 *
 * The game finds it through a relay.json next to index.html: { "url": "relay.php", "transport": "http" }.
 * Needs PHP 8.1 or newer.
 */

declare(strict_types=1);

require_once __DIR__ . '/common.php';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE = '/^[A-Z2-9]{4,8}$/';
/** Battle messages are tiny; anything bigger is not from the game. */
const MAX_MESSAGE = 4096;
const MAX_BATCH = 20;
/** Fewer than the Node relay's 2000: every waiting player holds a PHP worker, so shared hosting fits far fewer. */
const MAX_ROOMS = 300;
/**
 * Unread messages per connection. A player who keeps polling never comes near it; one who stops reading is
 * closed instead of piling up the shared state that every request reads.
 */
const MAX_INBOX_BYTES = 32 * 1024;
/**
 * Open connections per visitor (IP address), so one visitor can't take every room or dojo place. A phone needs
 * one or two. Set PETHATCH_MAX_PER_IP to change it; 0 turns it off, e.g. behind a proxy or CDN that makes every
 * player arrive from the same address.
 */
const MAX_PER_IP = 16;
/**
 * Wrong room codes one visitor may try (an unknown code as guest, a taken one as host) before being turned away
 * for a while, so nobody can guess their way into a friend's battle. Off along with the per-visitor limit.
 */
const MAX_ROOM_MISSES = 10;
const ROOM_MISS_WINDOW_MS = 10 * 60_000;
/** A room nobody writes to for this long is closed (a forgotten invite, a stalled battle). */
const ROOM_IDLE_MS = 15 * 60_000;
/** A room the dojo set up for two matched players closes if they haven't both arrived by then. */
const RESERVED_MS = 30_000;
/** Per connection: at most this many messages per window. */
const RATE_MESSAGES = 60;
const RATE_WINDOW_MS = 10_000;
/** How long a poll waits for news before answering empty; keep it well below the host's time limits. */
const POLL_WAIT_MS = 8_000;
const POLL_STEP_US = 250_000;
/** A connection not heard from for this long is gone. */
const STALE_MS = 25_000;

/** Stat limits by life stage (child … elder), as in the game. */
const STAT_CAPS = [0, 30, 60, 100, 100];
/**
 * Pets that visit the dojo are counted for the dashboard (stats.php), from the battle code they send anyway:
 * a key hashed with a secret from the parts that never change (type, the seed's 16 bits, name; the name is never
 * stored), with first and last visit and the last stage and form. Kept until this long after the last visit.
 */
const DOJO_PETS_KEEP_DAYS = 90;
/** Dojo matching, as in server/dojo.mjs. */
const DOJO_BASE_WINDOW = 0.1;
const DOJO_GROW_WINDOW = 0.05;
const DOJO_MAX_WINDOW = 0.35;
const DOJO_MIN_POINTS = 8;
const DOJO_REMATCH_MS = 2 * 60_000;
const DOJO_MAX_PLAYERS = 100;
/** Matching compares every waiting pair, so it runs at most this often rather than on every request. */
const DOJO_MATCH_EVERY_MS = 1000;

/** While nothing changes, a waiting poll looks at the full state only this often (for timeouts and cleanup). */
const POLL_FULL_CHECK_MS = 2000;
/** New dojo pets one visitor can add to the count per day, and the most pets the count keeps. */
const DOJO_NEW_PETS_PER_VISITOR = 5;
const DOJO_MAX_PETS = 20_000;

// Replies are JSON: a PHP notice in one would break it and show the server's file paths. Errors still get logged.
ini_set('display_errors', '0');

function now_ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

function reply(array $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/** Run $fn on the shared state, one request at a time; saves it again if it changed. */
function with_state(callable $fn): mixed
{
    try {
        return with_data('state.php', function (mixed &$state) use ($fn) {
            if (!is_array($state)) $state = ['rooms' => [], 'conns' => [], 'recent' => []];
            $state['salt'] ??= bin2hex(random_bytes(16));
            $now = now_ms();
            cleanup($state, $now);
            return $fn($state, $now);
        });
    } catch (DataUnavailable) {
        reply(['error' => 'The relay can’t store its data; see the server’s error log.'], 500);
    }
}

// ---------- connections ----------

function new_conn(array &$s, int $now, array $fields): string
{
    $id = 'c' . bin2hex(random_bytes(12));
    $s['conns'][$id] = $fields + [
        'seen' => $now,
        'seq' => 0,
        'inbox' => [],
        'closed' => false,
        'rate' => [$now, 0],
        'visitor' => visitor($s),
    ];
    return $id;
}

/** Who is asking, as a salted hash of the IP address (IPv6 by its /64): enough to count connections. */
function visitor(array $s): string
{
    return visitor_hash($s['salt']);
}

function max_per_visitor(): int
{
    $env = getenv('PETHATCH_MAX_PER_IP');
    return $env === false || $env === '' ? MAX_PER_IP : (int) $env;
}

/** Whether this visitor tried too many wrong room codes lately. */
function missed_too_often(array $s, int $now): bool
{
    if (max_per_visitor() <= 0) return false;
    $m = $s['misses'][visitor($s)] ?? null;
    return $m && $now - $m[0] < ROOM_MISS_WINDOW_MS && $m[1] >= MAX_ROOM_MISSES;
}

/** Note a wrong room code, and turn it down. */
function missed(array &$s, int $now, string $code): array
{
    $v = visitor($s);
    $m = $s['misses'][$v] ?? [$now, 0];
    if ($now - $m[0] >= ROOM_MISS_WINDOW_MS) $m = [$now, 0];
    $s['misses'][$v] = [$m[0], $m[1] + 1];
    return refused($code);
}

/** Whether this visitor may open another connection. */
function visitor_has_room(array $s): bool
{
    $max = max_per_visitor();
    if ($max <= 0) return true;
    $me = visitor($s);
    $open = 0;
    foreach ($s['conns'] as $c) {
        if (($c['visitor'] ?? '') === $me) $open++;
    }
    return $open < $max;
}

function push(array &$s, string $id, string $text): void
{
    if (!isset($s['conns'][$id]) || $s['conns'][$id]['closed']) return;
    $unread = strlen($text);
    foreach ($s['conns'][$id]['inbox'] as [, $queued]) $unread += strlen($queued);
    if ($unread > MAX_INBOX_BYTES) {
        // It stopped reading, as if its socket had gone quiet.
        end_conn($s, $id, 'idle');
        return;
    }
    $s['conns'][$id]['inbox'][] = [++$s['conns'][$id]['seq'], $text];
}

function message(array $msg): string
{
    return json_encode($msg, JSON_UNESCAPED_SLASHES);
}

/** End a connection: its last messages wait for its next poll, then it is gone. */
function end_conn(array &$s, string $id, ?string $error = null): void
{
    if (!isset($s['conns'][$id]) || $s['conns'][$id]['closed']) return;
    // The error goes in even when the inbox is full, so the player learns why.
    if ($error) $s['conns'][$id]['inbox'][] = [++$s['conns'][$id]['seq'], message(['t' => 'error', 'code' => $error])];
    $s['conns'][$id]['closed'] = true;
    detach($s, $id);
}

/** Take a connection out of its room or the dojo queue and tell whoever is left. */
function detach(array &$s, string $id): void
{
    $c = $s['conns'][$id] ?? null;
    if (!$c) return;
    if ($c['kind'] === 'room') {
        $code = $c['room'];
        if (!isset($s['rooms'][$code])) return;
        $peers = array_values(array_filter($s['rooms'][$code]['peers'], fn ($p) => $p !== $id));
        if (!$peers) {
            unset($s['rooms'][$code]);
            return;
        }
        $s['rooms'][$code]['peers'] = $peers;
        announce($s, $code);
    } elseif ($c['waiting']) {
        $s['conns'][$id]['waiting'] = false;
        announce_dojo($s);
    }
}

function announce(array &$s, string $code): void
{
    $peers = $s['rooms'][$code]['peers'];
    foreach ($peers as $p) push($s, $p, message(['t' => 'room', 'peers' => count($peers)]));
}

function within_rate(array &$s, string $id, int $now, int $count): bool
{
    [$start, $sent] = $s['conns'][$id]['rate'];
    if ($now - $start > RATE_WINDOW_MS) [$start, $sent] = [$now, 0];
    $s['conns'][$id]['rate'] = [$start, $sent + $count];
    return $sent + $count <= RATE_MESSAGES;
}

/** Forward a client's messages to the other player in its room (the dojo has nobody to forward to). */
/** Message types only the relay itself sends (errors, room and dojo news, matches). */
const RELAY_TYPES = ['error', 'room', 'dojo', 'match'];

function speaks_for_relay(string $text): bool
{
    $m = json_decode($text, true);
    return is_array($m) && in_array($m['t'] ?? null, RELAY_TYPES, true);
}

function forward(array &$s, string $id, mixed $msgs, int $now): void
{
    if (!is_array($msgs) || count($msgs) > MAX_BATCH) {
        end_conn($s, $id, 'bad-request');
        return;
    }
    foreach ($msgs as $text) {
        if (!is_string($text) || strlen($text) > MAX_MESSAGE) {
            end_conn($s, $id, 'bad-request');
            return;
        }
    }
    if (!within_rate($s, $id, $now, count($msgs))) {
        end_conn($s, $id, 'rate');
        return;
    }
    // A player may not speak for the relay (e.g. a fake error that would end the other player's battle as a loss).
    $msgs = array_values(array_filter($msgs, fn(string $text) => !speaks_for_relay($text)));
    $c = $s['conns'][$id];
    if ($c['kind'] !== 'room' || !$msgs || !isset($s['rooms'][$c['room']])) return;
    $s['rooms'][$c['room']]['touched'] = $now;
    foreach ($s['rooms'][$c['room']]['peers'] as $p) {
        if ($p !== $id) foreach ($msgs as $text) push($s, $p, $text);
    }
}

/** A connection's messages after `after` (dropping the ones it has seen). A closed connection is then gone. */
function deliver(array &$s, string $id, int $after): array
{
    $s['conns'][$id]['inbox'] = array_values(array_filter($s['conns'][$id]['inbox'], fn ($m) => $m[0] > $after));
    $c = $s['conns'][$id];
    if ($c['closed']) unset($s['conns'][$id]);
    return ['id' => $id, 'msgs' => $c['inbox'], 'closed' => $c['closed']];
}

/** A refusal before a connection exists: the error, and closed. */
function refused(string $code): array
{
    return ['msgs' => [[1, message(['t' => 'error', 'code' => $code])]], 'closed' => true];
}

/** Everything that would happen on timers in the Node relay, done whenever anyone makes a request. */
function cleanup(array &$s, int $now): void
{
    foreach (array_keys($s['conns']) as $id) {
        $id = (string) $id;
        if ($now - $s['conns'][$id]['seen'] <= STALE_MS) continue;
        if (!$s['conns'][$id]['closed']) detach($s, $id);
        unset($s['conns'][$id]);
    }
    foreach (array_keys($s['rooms']) as $code) {
        $code = (string) $code;
        $room = $s['rooms'][$code];
        $reservedRanOut = $room['deadline'] && $now > $room['deadline'];
        if (!$reservedRanOut && $now - $room['touched'] <= ROOM_IDLE_MS) continue;
        // Close everyone first, so nobody hears about the others leaving before the reason.
        foreach ($room['peers'] as $p) {
            push($s, $p, message(['t' => 'error', 'code' => 'idle']));
            if (isset($s['conns'][$p])) $s['conns'][$p]['closed'] = true;
        }
        unset($s['rooms'][$code]);
    }
    foreach ($s['recent'] as $key => $at) {
        if ($now - $at > DOJO_REMATCH_MS) unset($s['recent'][$key]);
    }
    foreach ($s['misses'] ?? [] as $v => [$since]) {
        if ($now - $since >= ROOM_MISS_WINDOW_MS) unset($s['misses'][$v]);
    }
    if ($now - ($s['matchedAt'] ?? 0) >= DOJO_MATCH_EVERY_MS) match_dojo($s, $now);
}

// ---------- rooms ----------

function join_room(array &$s, int $now, string $code, string $role): array
{
    if (missed_too_often($s, $now)) return refused('busy');
    $room = $s['rooms'][$code] ?? null;
    if ($role === 'host') {
        // A room the dojo reserved is waiting for its host; any other existing room is taken.
        if ($room && !($room['reserved'] && !$room['hasHost'])) return missed($s, $now, 'taken');
        if (!$room) {
            if (count($s['rooms']) >= MAX_ROOMS) return refused('busy');
            $room = new_room($now, false);
        }
        $room['hasHost'] = true;
    } else {
        if (!$room) return missed($s, $now, 'no-room');
        if (count($room['peers']) >= 2) return refused('full');
    }
    if (!visitor_has_room($s)) return refused('busy');
    $id = new_conn($s, $now, ['kind' => 'room', 'room' => $code]);
    $room['peers'][] = $id;
    $room['touched'] = $now;
    if (count($room['peers']) >= 2) $room['deadline'] = 0;
    $s['rooms'][$code] = $room;
    announce($s, $code);
    return deliver($s, $id, 0);
}

function new_room(int $now, bool $reserved): array
{
    return [
        'peers' => [],
        'touched' => $now,
        'reserved' => $reserved,
        'hasHost' => false,
        'deadline' => $reserved ? $now + RESERVED_MS : 0,
    ];
}

function new_room_code(array $s): string
{
    do {
        $code = '';
        for ($i = 0; $i < 5; $i++) $code .= ROOM_ALPHABET[random_int(0, strlen(ROOM_ALPHABET) - 1)];
    } while (isset($s['rooms'][$code]));
    return $code;
}

// ---------- dojo ----------

function checksum(array $bytes): int
{
    $h = 0x811c9dc5;
    foreach ($bytes as $b) $h = (($h ^ $b) * 0x01000193) & 0xffffffff;
    return ($h ^ ($h >> 8) ^ ($h >> 16) ^ ($h >> 24)) & 0xff;
}

/**
 * The battle rating of a battle code, or null if it isn't a valid one. Mirrors ratingFromCode() in
 * server/dojo.mjs, so a player can't claim a weaker pet than the one they fight with.
 */
function rating_from_code(mixed $code): ?int
{
    if (!is_string($code) || !preg_match('/^[A-Za-z0-9_-]{16,120}$/', $code)) return null;
    $bin = base64_decode(strtr($code, '-_', '+/'));
    if ($bin === false || strlen($bin) < 12) return null;
    $bytes = array_values(unpack('C*', $bin));
    $check = array_pop($bytes);
    if (checksum($bytes) !== $check || $bytes[0] !== 1) return null;
    $stage = ($bytes[1] >> 3) & 7;
    if ($stage < 1 || $stage > 4) return null;
    $stats = array_slice($bytes, 3, 4);
    foreach ($stats as $stat) if ($stat > STAT_CAPS[$stage]) return null;
    return array_sum($stats) + 20 * min($stage, 3);
}

/**
 * Count a pet that got into the dojo (its battle code already checked by rating_from_code). Battle codes are easy
 * to make up, so one visitor adds at most DOJO_NEW_PETS_PER_VISITOR new pets a day, and the count keeps at most
 * DOJO_MAX_PETS. Never fails the visit.
 */
function count_dojo_pet(string $code): void
{
    $bytes = array_values(unpack('C*', base64_decode(strtr($code, '-_', '+/'))));
    array_pop($bytes);
    try {
        with_data('dojo-pets.php', function (mixed &$data) use ($bytes) {
            if (!is_array($data)) $data = ['secret' => bin2hex(random_bytes(32)), 'pets' => [], 'days' => []];
            $today = gmdate('Y-m-d');
            if (($data['visitors']['day'] ?? '') !== $today) {
                // Yesterday's visitor hashes and salt go, as in stats.php.
                $data['visitors'] = ['day' => $today, 'salt' => bin2hex(random_bytes(16)), 'new' => []];
                $oldest = gmdate('Y-m-d', time() - DOJO_PETS_KEEP_DAYS * 86400);
                $data['pets'] = array_filter($data['pets'], fn($p) => $p['last'] >= $oldest);
                $data['days'] = array_filter($data['days'], fn($d) => $d >= gmdate('Y-m-d', time() - 400 * 86400), ARRAY_FILTER_USE_KEY);
            }
            $stable = implode(',', [$bytes[1] >> 6, $bytes[8], $bytes[9], ...array_slice($bytes, 10)]);
            $key = substr(hash_hmac('sha256', $stable, $data['secret']), 0, 16);
            $pet = $data['pets'][$key] ?? null;
            if (!$pet) {
                $visitor = visitor_hash($data['visitors']['salt']);
                $added = $data['visitors']['new'][$visitor] ?? 0;
                if ($added >= DOJO_NEW_PETS_PER_VISITOR || count($data['pets']) >= DOJO_MAX_PETS) return;
                $data['visitors']['new'][$visitor] = $added + 1;
                $pet = ['first' => $today, 'last' => ''];
            }
            if ($pet['last'] !== $today) {
                $data['days'][$today]['pets'] = ($data['days'][$today]['pets'] ?? 0) + 1;
                if ($pet['first'] === $today) $data['days'][$today]['new'] = ($data['days'][$today]['new'] ?? 0) + 1;
            }
            $data['pets'][$key] = ['first' => $pet['first'], 'last' => $today, 'stage' => ($bytes[1] >> 3) & 7, 'form' => $bytes[2]];
        });
    } catch (DataUnavailable) {
        // Counting is a bonus; the dojo works without it.
    }
}

function match_window(int $rating, int $waitedMs): float
{
    $share = min(DOJO_MAX_WINDOW, DOJO_BASE_WINDOW + DOJO_GROW_WINDOW * floor($waitedMs / 10_000));
    return max(DOJO_MIN_POINTS, $rating * $share);
}

function pair_key(string $x, string $y): string
{
    return $x < $y ? "$x|$y" : "$y|$x";
}

/** Connection ids of the players waiting in the dojo. */
function waiting(array $s): array
{
    $ids = [];
    foreach ($s['conns'] as $id => $c) {
        if ($c['kind'] === 'dojo' && $c['waiting']) $ids[] = (string) $id;
    }
    return $ids;
}

function announce_dojo(array &$s): void
{
    $ids = waiting($s);
    foreach ($ids as $id) push($s, $id, message(['t' => 'dojo', 'players' => count($ids) - 1]));
}

function join_dojo(array &$s, int $now, int $rating, string $player, string $code): array
{
    if (count(waiting($s)) >= DOJO_MAX_PLAYERS || !visitor_has_room($s)) return refused('busy');
    $id = new_conn($s, $now, ['kind' => 'dojo', 'waiting' => true, 'player' => $player, 'rating' => $rating, 'code' => $code, 'joinedAt' => $now]);
    announce_dojo($s);
    return deliver($s, $id, 0);
}

/** Pair waiting players (closest ratings first, as in server/dojo.mjs) and send each pair into a fresh room. */
function match_dojo(array &$s, int $now): void
{
    $ids = waiting($s);
    if (count($ids) < 2 || count($s['rooms']) >= MAX_ROOMS) return;
    $s['matchedAt'] = $now;
    $candidates = [];
    foreach ($ids as $i => $a) {
        foreach (array_slice($ids, $i + 1) as $b) {
            $x = $s['conns'][$a];
            $y = $s['conns'][$b];
            if ($x['player'] === $y['player']) continue;
            $diff = abs($x['rating'] - $y['rating']);
            $allowed = min(match_window($x['rating'], $now - $x['joinedAt']), match_window($y['rating'], $now - $y['joinedAt']));
            if ($diff > $allowed) continue;
            if ($now - ($s['recent'][pair_key($x['player'], $y['player'])] ?? PHP_INT_MIN) < DOJO_REMATCH_MS) continue;
            $candidates[] = [$a, $b, $diff];
        }
    }
    usort($candidates, fn ($p, $q) => $p[2] <=> $q[2]);
    $used = [];
    foreach ($candidates as [$a, $b]) {
        if (isset($used[$a]) || isset($used[$b])) continue;
        $used[$a] = $used[$b] = true;
        $code = new_room_code($s);
        $s['rooms'][$code] = new_room($now, true);
        $s['recent'][pair_key($s['conns'][$a]['player'], $s['conns'][$b]['player'])] = $now;
        foreach ([[$a, 'host', $b], [$b, 'guest', $a]] as [$id, $role, $other]) {
            // The other pet's code, so the game can check it really battles the pet it was matched with.
            push($s, $id, message(['t' => 'match', 'room' => $code, 'role' => $role, 'foe' => $s['conns'][$other]['code'] ?? null]));
            $s['conns'][$id]['waiting'] = false;
            $s['conns'][$id]['closed'] = true;
        }
    }
    if ($used) announce_dojo($s);
}

// ---------- requests ----------

header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST');
    header('Access-Control-Allow-Headers: content-type');
    exit;
}
if ($method === 'GET' && ($_GET['a'] ?? '') === 'health') {
    $rooms = with_state(fn (array &$s) => count($s['rooms']));
    header('Content-Type: text/plain');
    echo "ok $rooms rooms\n";
    exit;
}
if ($method !== 'POST') reply(['error' => 'Pet Hatch relay: POST only'], 405);

$req = json_decode((string) file_get_contents('php://input', false, null, 0, 256 * 1024), true);
if (!is_array($req)) reply(refused('bad-request'), 400);
/** A text field of the request, or '' if it is missing or not text. */
function field(array $req, string $key): string
{
    return is_string($req[$key] ?? null) ? $req[$key] : '';
}
$id = field($req, 'id');

switch (field($req, 'a')) {
    case 'join':
        $code = strtoupper(field($req, 'room'));
        $role = field($req, 'role');
        if (!preg_match(ROOM_CODE, $code) || ($role !== 'host' && $role !== 'guest')) reply(refused('bad-request'));
        reply(with_state(fn (array &$s, int $now) => join_room($s, $now, $code, $role)));

    case 'dojo':
        $rating = rating_from_code($req['code'] ?? null);
        if ($rating === null || $id === '' || strlen($id) > 40) reply(refused('bad-request'));
        $player = $id;
        $battleCode = $req['code'];
        $joined = with_state(fn (array &$s, int $now) => join_dojo($s, $now, $rating, $player, $battleCode));
        // Only pets that actually got in count (not ones turned away because the dojo is full).
        if (isset($joined['id'])) count_dojo_pet($req['code']);
        reply($joined);

    case 'send':
        reply(with_state(function (array &$s, int $now) use ($id, $req) {
            if (!isset($s['conns'][$id])) return ['gone' => true];
            // A closed connection's last words (an error) reach it with its next poll.
            if ($s['conns'][$id]['closed']) return [];
            $s['conns'][$id]['seen'] = $now;
            forward($s, $id, $req['msgs'] ?? null, $now);
            return [];
        }));

    case 'leave':
        reply(with_state(function (array &$s, int $now) use ($id, $req) {
            if (!isset($s['conns'][$id])) return ['closed' => true];
            if (!$s['conns'][$id]['closed'] && !empty($req['msgs'])) forward($s, $id, $req['msgs'], $now);
            if (!$s['conns'][$id]['closed']) detach($s, $id);
            unset($s['conns'][$id]);
            return ['closed' => true];
        }));

    case 'poll':
        $after = is_int($req['after'] ?? null) ? $req['after'] : 0;
        $until = now_ms() + POLL_WAIT_MS;
        set_time_limit(intdiv(POLL_WAIT_MS, 1000) + 20);
        // One poll per connection: a new one ends the one before, so nobody can tie up every PHP worker with
        // many polls on one connection.
        $poll = bin2hex(random_bytes(8));
        $first = true;
        $stamp = '';
        $lookedAt = 0;
        while (true) {
            // While the state file hasn't changed, there's nothing new to deliver: skip reading it, except now and
            // then for timeouts and cleanup.
            if (!$first && data_stamp('state.php') === $stamp && now_ms() - $lookedAt < POLL_FULL_CHECK_MS && now_ms() < $until) {
                usleep(POLL_STEP_US);
                continue;
            }
            // Stamped before reading, so a change made while (or right after) reading is never missed.
            $before = data_stamp('state.php');
            $res = with_state(function (array &$s, int $now) use ($id, $after, $until, $poll, &$first) {
                if (!isset($s['conns'][$id])) return ['gone' => true];
                if ($first) {
                    // Seen when the poll starts and when it ends: well within STALE_MS, without a write every step.
                    $s['conns'][$id]['seen'] = $now;
                    $s['conns'][$id]['poll'] = $poll;
                } elseif (($s['conns'][$id]['poll'] ?? '') !== $poll) {
                    return ['msgs' => []];
                }
                $first = false;
                $c = $s['conns'][$id];
                $news = $c['closed'] || array_filter($c['inbox'], fn ($m) => $m[0] > $after);
                if (!$news && $now < $until) return null;
                $s['conns'][$id]['seen'] = $now;
                return deliver($s, $id, $after);
            });
            if ($res !== null) reply($res);
            $stamp = $before;
            $lookedAt = now_ms();
            usleep(POLL_STEP_US);
        }

    default:
        reply(refused('bad-request'), 400);
}
