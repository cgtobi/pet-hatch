<?php
/**
 * Pet Hatch stats for PHP hosting, in three tiers, and a dashboard for all of them behind a token:
 *
 * 1. Open games (everyone, no consent needed): every open game asks for version.json (src/update.ts: on start,
 *    on coming back, hourly). On Apache the .htaccess next to the game sends that request here; this answers with
 *    the same file and counts the game once a day as a hash of IP address and browser with a salt made fresh every
 *    day. Only today's hashes are kept; after that only the number stays, with the versions in use.
 * 2. Dojo pets (everyone who visits the dojo): relay.php counts pets from the battle code they send to be matched
 *    (see count_dojo_pet() there) into dojo-pets.php; this only shows it.
 * 3. Pet details (players who opted in): POSTed snapshots (src/net/stats.ts), one log file per day for
 *    KEEP_LOG_DAYS days. A visitor's reports per day are limited with a daily-salted hash; no IP is stored.
 *
 *   GET  version.json (via .htaccess) or stats.php?check   version.json, counted
 *   POST stats.php                                       a pet snapshot (JSON, at most MAX_BODY bytes) → 204
 *   GET  stats.php?view&token=…                          the dashboard (&days=30|90|365)
 *
 * The dashboard's token comes from PETHATCH_STATS_TOKEN, or from stats-token.php, best kept in a pet-hatch-private
 * folder outside the web folder (see private_file() in common.php)
 * (<?php return '…';), which npm run deploy writes. Without one the dashboard stays off.
 * Data lives in the relay's data folder (relay-data/, or PETHATCH_DATA_DIR). Needs PHP 8.1 or newer.
 */

declare(strict_types=1);

require_once __DIR__ . '/common.php';

const WINDOWS = [30, 90, 365];
/** Daily totals are kept this long. */
const KEEP_DAYS = 400;
/** Opt-in pet snapshots are kept this long. */
const KEEP_LOG_DAYS = 180;
const MAX_BODY = 512;
/** Snapshots one visitor (IP address; IPv6 by /64) may send per day: a pet sends one or two, a household a handful. */
const MAX_PER_VISITOR = 200;
/** Snapshots kept per day in all, so nobody can fill the disk. */
const MAX_SNAPSHOTS_PER_DAY = 5000;
/** Open games one visitor counts for per day (a household's phones and tablets), and per day in all. */
const MAX_GAMES_PER_VISITOR = 8;
const MAX_GAMES_PER_DAY = 100_000;
const TYPES = ['ember', 'tide', 'bloom', 'astral'];
const MODES = ['cozy', 'gentle', 'classic'];
const STATUSES = ['alive', 'retired', 'ranAway', 'died', 'lost', 'released'];
const STAGES = ['Baby', 'Child', 'Teen', 'Adult', 'Elder'];
/** The battle code's form numbers, as in src/sim/battlecode.ts. */
const CODE_FORMS = ['baby', 'child.bright', 'child.scruffy', 'teen.physical', 'teen.technical', 'adult.power',
    'adult.speed', 'adult.guard', 'adult.wits'];
ini_set('display_errors', '0');

function fail(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message, "\n";
    exit;
}

// ---------- 1. open games ----------

/** Count this game once for today, then answer with version.json as if it had been asked for directly. */
function check(): never
{
    $version = is_string($_GET['v'] ?? null) && preg_match('/^\d{1,3}\.\d{1,3}\.\d{1,3}$/', $_GET['v'])
        ? $_GET['v'] : 'older';
    try {
        with_data('players.php', fn(mixed &$c) => count_game($c, $version));
    } catch (DataUnavailable) {
        // Counting is a bonus; the update check still gets its answer.
    }
    $file = __DIR__ . '/version.json';
    if (!is_file($file)) fail(404, 'No version.json.');
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    readfile($file);
    exit;
}

/**
 * Count the asking game once for today. Random browser strings could make one visitor look like many games, so
 * a visitor counts for at most MAX_GAMES_PER_VISITOR, and a day for at most MAX_GAMES_PER_DAY.
 */
function count_game(mixed &$c, string $version): void
{
    if (!is_array($c)) $c = ['days' => []];
    $day = gmdate('Y-m-d');
    if (($c['today'] ?? '') !== $day) {
        // A new day: yesterday's hashes and salt go, so nothing links one day's games to another's.
        $c['today'] = $day;
        $c['salt'] = bin2hex(random_bytes(16));
        $c['seen'] = [];
        $c['visitors'] = [];
        $oldest = gmdate('Y-m-d', time() - KEEP_DAYS * 86400);
        $c['days'] = array_filter($c['days'], fn($d) => $d >= $oldest, ARRAY_FILTER_USE_KEY);
    }
    $game = substr(hash('sha256', $c['salt'] . '|' . visitor_address() . '|'
        . substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300)), 0, 16);
    if (isset($c['seen'][$game]) || count($c['seen']) >= MAX_GAMES_PER_DAY) return;
    $visitor = visitor_hash($c['salt']);
    if (($c['visitors'][$visitor] ?? 0) >= MAX_GAMES_PER_VISITOR) return;
    $c['visitors'][$visitor] = ($c['visitors'][$visitor] ?? 0) + 1;
    $c['seen'][$game] = 1;
    $c['days'][$day]['games'] = ($c['days'][$day]['games'] ?? 0) + 1;
    $c['days'][$day]['versions'][$version] = ($c['days'][$day]['versions'][$version] ?? 0) + 1;
}

// ---------- 3. pet details (opt-in) ----------

/** The snapshot as a log row, or null if anything about it isn't what the game sends. */
function row(mixed $r): ?array
{
    if (!is_array($r)) return null;
    $int = fn(string $k, int $lo, int $hi) => is_int($r[$k] ?? null) && $r[$k] >= $lo && $r[$k] <= $hi;
    $in = fn(string $k, array $list) => in_array($r[$k] ?? null, $list, true);
    $pet = ($r['phase'] ?? null) === 'pet';
    $ok = is_string($r['pet'] ?? null) && preg_match('/^[0-9a-f]{14}$/', $r['pet'])
        && is_string($r['v'] ?? null) && preg_match('/^\d{1,3}\.\d{1,3}\.\d{1,3}$/', $r['v'])
        && $in('phase', ['egg', 'pet']) && $int('stage', 0, 4) && $in('mode', MODES)
        && $int('gen', 1, 9999) && $in('status', STATUSES) && $int('stars', 0, 4)
        && ($pet
            ? $in('type', TYPES) && is_string($r['form'] ?? null)
                && preg_match('/^(baby|(child|teen|adult)\.[a-z]{2,12})$/', $r['form'])
            : ($r['type'] ?? null) === null && ($r['form'] ?? null) === null);
    if (!$ok) return null;
    return [time(), $r['pet'], $r['v'], $r['phase'], $r['stage'], $r['type'], $r['form'], $r['mode'], $r['gen'],
        $r['status'], $r['stars']];
}

/** Counts this visitor's snapshot for today; false once over the limit. A new day brings a new salt. */
function within_limit(string $day): bool
{
    return (bool) with_data('stats-limits.php', function (mixed &$l) use ($day) {
        if (!is_array($l) || ($l['day'] ?? '') !== $day) {
            $l = ['day' => $day, 'salt' => bin2hex(random_bytes(16)), 'counts' => [], 'total' => 0];
            prune_logs();
        }
        $visitor = visitor_hash($l['salt']);
        if (($l['counts'][$visitor] ?? 0) >= MAX_PER_VISITOR || ($l['total'] ?? 0) >= MAX_SNAPSHOTS_PER_DAY) return false;
        $l['counts'][$visitor] = ($l['counts'][$visitor] ?? 0) + 1;
        $l['total'] = ($l['total'] ?? 0) + 1;
        return true;
    });
}

function prune_logs(): void
{
    $oldest = gmdate('Y-m-d', time() - KEEP_LOG_DAYS * 86400);
    foreach (glob(data_dir() . '/stats-????-??-??.php') ?: [] as $file) {
        if (substr(basename($file), 6, 10) < $oldest) @unlink($file);
    }
}

function collect(): never
{
    $body = (string) file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if (strlen($body) > MAX_BODY) fail(413, 'Too big.');
    $row = row(json_decode($body, true));
    if (!$row) fail(400, 'Not a pet snapshot.');
    $day = gmdate('Y-m-d');
    try {
        if (!within_limit($day)) fail(429, 'Too many reports today.');
    } catch (DataUnavailable) {
        fail(500, 'Can’t store stats; see the server’s error log.');
    }
    $file = data_dir() . "/stats-$day.php";
    $handle = @fopen($file, 'a');
    if (!$handle || !flock($handle, LOCK_EX)) fail(500, 'Can’t store stats; see the server’s error log.');
    clearstatcache(true, $file);
    if (filesize($file) === 0) fwrite($handle, GUARD);
    fwrite($handle, json_encode($row, JSON_UNESCAPED_SLASHES) . "\n");
    flock($handle, LOCK_UN);
    fclose($handle);
    http_response_code(204);
    exit;
}

/**
 * The opt-in snapshots of the last $days days (UTC), oldest first: each pet's story so far, and which pets
 * reported on each day. Read line by line, so even months of logs don't have to fit in memory at once.
 */
function read_logs(int $days): array
{
    $pets = [];
    $byDay = [];
    for ($i = min($days, KEEP_LOG_DAYS) - 1; $i >= 0; $i--) {
        $day = gmdate('Y-m-d', time() - $i * 86400);
        $handle = @fopen(data_dir() . "/stats-$day.php", 'r');
        if (!$handle) continue;
        fgets($handle);
        while (($line = fgets($handle)) !== false) {
            $row = json_decode($line, true);
            if (!is_array($row) || count($row) !== 11) continue;
            $byDay[$day][$row[1]] = true;
            add_snapshot($pets, $day, $row);
        }
        fclose($handle);
    }
    return [$pets, $byDay];
}

/** Add one snapshot to its pet's story. */
function add_snapshot(array &$pets, string $day, array $row): void
{
    [, $id, $v, $phase, $stage, $type, $form, $mode, $gen, $status, $stars] = $row;
    $p = $pets[$id] ?? ['first' => $day, 'startedAsEgg' => $phase === 'egg', 'reached' => -1, 'stars' => 0];
    if ($phase === 'pet') $p['reached'] = max($p['reached'], $stage);
    $p['last'] = $day;
    $p['mode'] = $mode;
    $p['gen'] = max($p['gen'] ?? 1, $gen);
    $p['stars'] = max($p['stars'], $stars);
    if ($type) $p['type'] = $type;
    if ($form) $p['form'] = $form;
    // An ending sticks, even if an older tab reports the pet alive afterwards.
    if (($p['status'] ?? 'alive') === 'alive') $p['status'] = $status;
    $pets[$id] = $p;
}

// ---------- the dashboard ----------

function h(string|int $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES);
}

/** Labelled horizontal bars, largest first unless $keep. */
function bars(array $counts, bool $keep = false): string
{
    if (!$keep) arsort($counts);
    $max = max([1, ...array_values($counts)]);
    $out = '';
    foreach ($counts as $label => $n) {
        $out .= '<div class="bar"><span>' . h($label) . '</span><i style="width:' . round(100 * $n / $max, 1)
            . '%"></i><b>' . $n . '</b></div>';
    }
    return $out ?: '<p class="muted">Nothing yet.</p>';
}

/** A column per day, with KPIs: today, yesterday and averages over the days since counting began. */
function series_card(array $series, string $since, array $extra = []): array
{
    $values = array_values($series);
    $counted = count(array_filter(array_keys($series), fn($d) => $d >= $since));
    $avg = fn(int $n) => (int) round(array_sum(array_slice($values, -$n)) / max(1, min($n, $counted)));
    $peak = max([0, ...$values]);
    $chart = '';
    foreach ($series as $day => $n) {
        $chart .= '<div class="col" title="' . h("$day: $n") . '"><i style="height:'
            . round(100 * $n / max(1, $peak), 1) . '%"></i></div>';
    }
    $kpis = [[$values[count($values) - 1], 'today'], [$values[count($values) - 2] ?? 0, 'yesterday'],
        [$avg(7), '7-day average'], [$avg(30), '30-day average'], ...$extra];
    $kpiHtml = implode('', array_map(fn($k) => "<div class=\"kpi\"><b>{$k[0]}</b><span>{$k[1]}</span></div>", $kpis));
    return [$kpiHtml, $chart, $peak, $peak ? array_search($peak, $series, true) : '–'];
}

function dashboard(): never
{
    $token = dashboard_token();
    if (!$token) fail(403, 'The dashboard is off: upload stats-token.php to pet-hatch-private/ (or set PETHATCH_STATS_TOKEN).');
    if (!is_string($_GET['token'] ?? null) || !hash_equals($token, $_GET['token'])) fail(403, 'Wrong token.');
    $asked = (int) ($_GET['days'] ?? 90);
    $days = in_array($asked, WINDOWS, true) ? $asked : 90;
    $since = fn(int $n) => gmdate('Y-m-d', time() - ($n - 1) * 86400);
    $range = [];
    for ($i = $days - 1; $i >= 0; $i--) $range[] = gmdate('Y-m-d', time() - $i * 86400);

    // 1. Open games.
    try {
        $games = read_data('players.php')['days'] ?? [];
        $dojo = read_data('dojo-pets.php') ?: [];
        [$allPets, $optIn] = read_logs(max($days, 30));
    } catch (DataUnavailable) {
        fail(500, 'Can’t read the stats; see the server’s error log.');
    }
    $gameSeries = array_combine($range, array_map(fn($d) => $games[$d]['games'] ?? 0, $range));
    [$gameKpis, $gameChart, $gamePeak, $gamePeakDay] = series_card($gameSeries, $games ? min(array_keys($games)) : '9999');
    $todayKey = gmdate('Y-m-d');
    $yesterdayKey = gmdate('Y-m-d', time() - 86400);
    $versionDay = array_sum($games[$todayKey]['versions'] ?? []) >= 10 || !isset($games[$yesterdayKey]) ? $todayKey : $yesterdayKey;
    $versions = $games[$versionDay]['versions'] ?? [];
    uksort($versions, fn($a, $b) => version_compare($b === 'older' ? '0' : $b, $a === 'older' ? '0' : $a));

    // 2. Dojo pets.
    $dojoDays = $dojo['days'] ?? [];
    $dojoPets = $dojo['pets'] ?? [];
    $dojoSeries = array_combine($range, array_map(fn($d) => $dojoDays[$d]['pets'] ?? 0, $range));
    $seenSince = fn(int $n) => count(array_filter($dojoPets, fn($p) => $p['last'] >= $since($n)));
    [$dojoKpis, $dojoChart] = series_card($dojoSeries, $dojoDays ? min(array_keys($dojoDays)) : '9999',
        [[$seenSince(7), 'pets in 7 days'], [$seenSince(30), 'pets in 30 days']]);
    $newInWindow = array_sum(array_map(fn($d) => $dojoDays[$d]['new'] ?? 0, $range));
    $returning = count(array_filter($dojoPets, fn($p) => $p['last'] >= $since(30) && $p['first'] < $p['last']));
    $dojoStages = [];
    foreach ($dojoPets as $p) {
        if ($p['last'] < $since(30)) continue;
        $label = STAGES[$p['stage']] ?? '?';
        $dojoStages[$label] = ($dojoStages[$label] ?? 0) + 1;
    }
    uksort($dojoStages, fn($a, $b) => array_search($a, STAGES, true) <=> array_search($b, STAGES, true));
    $dojoForms = [];
    foreach ($dojoPets as $p) {
        $form = CODE_FORMS[$p['form']] ?? '';
        if ($p['last'] >= $since(30) && str_starts_with($form, 'adult.')) $dojoForms[ucfirst(substr($form, 6))] = ($dojoForms[ucfirst(substr($form, 6))] ?? 0) + 1;
    }

    // 3. Pet details (opt-in).
    $optSeries = array_combine($range, array_map(fn($d) => count($optIn[$d] ?? []), $range));
    [$optKpis, $optChart] = series_card($optSeries, $optIn ? min(array_keys($optIn)) : '9999');
    $pets = array_filter($allPets, fn($p) => $p['first'] >= $since(min($days, KEEP_LOG_DAYS)));
    $eggs = array_filter($pets, fn($p) => $p['startedAsEgg']);
    $funnel = ['Eggs' => count($eggs)];
    foreach (STAGES as $i => $name) $funnel[$name] = count(array_filter($eggs, fn($p) => $p['reached'] >= $i));
    $funnel['Retired'] = count(array_filter($eggs, fn($p) => $p['status'] === 'retired'));
    $endings = [];
    foreach ($pets as $p) if ($p['status'] !== 'alive') $endings[$p['mode']][$p['status']] = ($endings[$p['mode']][$p['status']] ?? 0) + 1;
    $count = function (callable $key, array $list): array {
        $c = [];
        foreach ($list as $p) {
            $k = $key($p);
            if ($k !== null) $c[$k] = ($c[$k] ?? 0) + 1;
        }
        return $c;
    };
    $hatched = array_filter($pets, fn($p) => $p['reached'] >= 0);
    $types = $count(fn($p) => isset($p['type']) ? ucfirst($p['type']) : null, $hatched);
    $forms = $count(fn($p) => str_starts_with($p['form'] ?? '', 'adult.') ? ucfirst(substr($p['form'], 6)) : null, $hatched);
    $gens = $count(fn($p) => $p['gen'] >= 4 ? 'Gen 4+' : "Gen {$p['gen']}", $pets);
    ksort($gens);
    $stars = $count(fn($p) => $p['reached'] >= 3 ? $p['stars'] . ' ★' : null, $pets);
    ksort($stars);
    $endingRows = '';
    foreach (MODES as $mode) {
        $cells = '';
        foreach (array_slice(STATUSES, 1) as $s) $cells .= '<td>' . ($endings[$mode][$s] ?? 0) . '</td>';
        $endingRows .= '<tr><th>' . h(ucfirst($mode)) . "</th>$cells</tr>";
    }
    $statusHead = implode('', array_map(fn($s) => '<th>' . h(ucfirst(preg_replace('/(?<!^)[A-Z]/', ' $0', $s))) . '</th>',
        array_slice(STATUSES, 1)));
    $joined = count($pets) - count($eggs);
    $detailDays = min($days, KEEP_LOG_DAYS);

    $links = implode(' · ', array_map(
        fn($d) => $d === $days ? "<b>$d days</b>" : '<a href="?view&amp;token=' . h($_GET['token']) . "&amp;days=$d\">$d days</a>",
        WINDOWS,
    ));
    $b = fn(array $c, bool $keep = false) => bars($c, $keep);
    $title = 'Pet Hatch stats';

    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    // The token is in this page's address: never hand it on to another site.
    header('Referrer-Policy: no-referrer');
    echo <<<HTML
    <!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex"><title>$title</title>
    <style>
      :root { --ink: #2e2a3a; --muted: #6b6478; --bar: #8c76d6; --bg: #f6f2fa; --card: #fff; }
      @media (prefers-color-scheme: dark) { :root { --ink: #ece8f4; --muted: #a8a0b8; --bar: #a993f0; --bg: #1c1a24; --card: #26232f; } }
      body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font: 15px/1.4 system-ui, sans-serif; }
      main { max-width: 780px; margin: 0 auto; display: grid; gap: 14px; }
      section { background: var(--card); border-radius: 16px; padding: 16px; min-width: 0; }
      h1 { margin: 0; font-size: 22px; } h2 { margin: 0 0 6px; font-size: 18px; } h3 { margin: 0 0 8px; font-size: 15px; }
      a { color: var(--bar); } .muted { color: var(--muted); } .tier { margin: 10px 0 -4px; color: var(--muted); font-weight: 700; }
      .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-top: 8px; }
      .kpi b { display: block; font-size: 26px; } .kpi span { color: var(--muted); font-size: 13px; }
      .chart { display: flex; align-items: flex-end; gap: 1px; height: 120px; margin-top: 14px; }
      .col { flex: 1; height: 100%; display: flex; align-items: flex-end; }
      .col i { width: 100%; background: var(--bar); border-radius: 2px 2px 0 0; min-height: 1px; }
      .bar { display: grid; grid-template-columns: 76px 1fr 44px; align-items: center; gap: 8px; margin: 4px 0; }
      .bar i { height: 12px; background: var(--bar); border-radius: 6px; } .bar b { text-align: right; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { padding: 4px 6px; text-align: right; } th:first-child { text-align: left; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    </style></head><body><main>
    <section><h1>$title</h1><p class="muted">Days are UTC. Charts show the last $days days.</p><p>$links</p></section>

    <p class="tier">1 · Everyone, no consent needed</p>
    <section><h2>Games open per day</h2>
      <p class="muted">From the update check: each browser and network once a day, without cookies or IDs. A household
      sharing one address counts once; a phone changing networks may count twice.</p>
      <div class="kpis">$gameKpis</div><div class="chart">$gameChart</div>
      <p class="muted">Busiest: $gamePeak on $gamePeakDay.</p></section>
    <section><h3>Versions in use, $versionDay</h3>{$b($versions, true)}
      <p class="muted">"older" is a version from before the update check named itself.</p></section>

    <p class="tier">2 · Pets in the dojo, no consent needed</p>
    <section><h2>Dojo pets per day</h2>
      <p class="muted">Pets that went to the dojo, told apart by their battle code's unchanging parts (hashed; names
      never stored). Only from the child stage on, and only players who use the dojo.</p>
      <div class="kpis">$dojoKpis</div><div class="chart">$dojoChart</div>
      <p class="muted">New in the last $days days: $newInWindow. Came back on a later day (last 30 days): $returning.</p></section>
    <div class="grid">
      <section><h3>Stages in the dojo (30 days)</h3>{$b($dojoStages, true)}</section>
      <section><h3>Adult forms in the dojo (30 days)</h3>{$b($dojoForms)}</section>
    </div>

    <p class="tier">3 · Pet details, players who opted in</p>
    <section><h2>Opted-in pets per day</h2><div class="kpis">$optKpis</div><div class="chart">$optChart</div></section>
    <section><h3>How far pets get</h3>
      <p class="muted">Eggs first seen in the last $detailDays days, and how many reached each stage. $joined more pets
      joined after hatching (their players opted in later) and are left out here.</p>{$b($funnel, true)}</section>
    <section><h3>How stories ended</h3><p class="muted">Pets seen in the last $detailDays days whose story is over, by mode.</p>
      <table><tr><th>Mode</th>$statusHead</tr>$endingRows</table></section>
    <div class="grid">
      <section><h3>Types</h3>{$b($types)}</section>
      <section><h3>Adult forms</h3>{$b($forms)}</section>
      <section><h3>Generations</h3>{$b($gens, true)}</section>
      <section><h3>Stars of adults</h3>{$b($stars, true)}</section>
    </div>
    </main></body></html>
    HTML;
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST') collect();
if (isset($_GET['view'])) dashboard();
$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
if (isset($_GET['check']) || str_ends_with($path, '/version.json')) check();
fail(404, 'Pet Hatch stats: nothing here.');
