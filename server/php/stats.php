<?php
/**
 * Pet Hatch player count for PHP hosting: how many games are open per day, without cookies, IDs or anything
 * stored on the player's device.
 *
 * Every open game already asks for version.json (src/update.ts: on start, on coming back, hourly) to offer a
 * reload when there's a newer version. On Apache, the .htaccess next to the game sends that request here; this
 * answers with the same file and counts the game once a day: a hash of the IP address and browser with a secret
 * salt made fresh every day. Only today's hashes are kept, to count each game once; at the end of the day they
 * and the salt are thrown away and only the number stays, with the versions in use (the request names its own).
 *
 *   GET version.json (via .htaccess) or stats.php?check   version.json, counted
 *   GET stats.php?view&token=…                            the dashboard (&days=30|90|365)
 *
 * The dashboard's token comes from PETHATCH_STATS_TOKEN, or from stats-token.php next to this file
 * (<?php return '…';), which npm run deploy writes. Without one the dashboard stays off.
 * Data lives in the relay's data folder (relay-data/, or PETHATCH_DATA_DIR). Needs PHP 8.1 or newer.
 */

declare(strict_types=1);

const WINDOWS = [30, 90, 365];
/** Daily totals are kept this long. */
const KEEP_DAYS = 400;
/** Data files are PHP, so a web server that hands out the data folder only ever shows an empty page. */
const GUARD = "<?php exit; ?>\n";

ini_set('display_errors', '0');

function fail(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message, "\n";
    exit;
}

function data_file(): ?string
{
    $dir = getenv('PETHATCH_DATA_DIR') ?: __DIR__ . '/relay-data';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        error_log("Pet Hatch stats: can’t create its data folder $dir");
        return null;
    }
    if (!file_exists("$dir/.htaccess")) @file_put_contents("$dir/.htaccess", "Require all denied\n");
    return "$dir/players.php";
}

/** Run $fn on the counts, one request at a time, and save them again. Null when they can't be stored. */
function with_counts(callable $fn): mixed
{
    $file = data_file();
    $handle = $file ? @fopen($file, 'c+') : false;
    if (!$handle || !flock($handle, LOCK_EX)) {
        if ($file) error_log("Pet Hatch stats: can’t write $file");
        return null;
    }
    $counts = json_decode(substr((string) stream_get_contents($handle), strlen(GUARD)), true);
    if (!is_array($counts)) $counts = ['days' => []];
    $result = $fn($counts);
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, GUARD . json_encode($counts, JSON_UNESCAPED_SLASHES));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    return $result;
}

/** Count this game once for today, then answer with version.json as if it had been asked for directly. */
function check(): never
{
    $version = is_string($_GET['v'] ?? null) && preg_match('/^\d{1,3}\.\d{1,3}\.\d{1,3}$/', $_GET['v'])
        ? $_GET['v'] : 'older';
    with_counts(function (array &$c) use ($version) {
        $day = gmdate('Y-m-d');
        if (($c['today'] ?? '') !== $day) {
            // A new day: yesterday's hashes and salt go, so nothing links one day's games to another's.
            $c['today'] = $day;
            $c['salt'] = bin2hex(random_bytes(16));
            $c['seen'] = [];
            $oldest = gmdate('Y-m-d', time() - KEEP_DAYS * 86400);
            $c['days'] = array_filter($c['days'], fn($d) => $d >= $oldest, ARRAY_FILTER_USE_KEY);
        }
        $game = substr(hash('sha256', $c['salt'] . '|' . ($_SERVER['REMOTE_ADDR'] ?? '') . '|'
            . substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300)), 0, 16);
        if (isset($c['seen'][$game])) return;
        $c['seen'][$game] = 1;
        $c['days'][$day]['games'] = ($c['days'][$day]['games'] ?? 0) + 1;
        $c['days'][$day]['versions'][$version] = ($c['days'][$day]['versions'][$version] ?? 0) + 1;
    });
    $file = __DIR__ . '/version.json';
    if (!is_file($file)) fail(404, 'No version.json.');
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    readfile($file);
    exit;
}

// ---------- the dashboard ----------

function dashboard_token(): ?string
{
    $token = getenv('PETHATCH_STATS_TOKEN') ?: null;
    if (!$token && is_file(__DIR__ . '/stats-token.php')) $token = include __DIR__ . '/stats-token.php';
    return is_string($token) && strlen($token) >= 16 ? $token : null;
}

function h(string|int $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES);
}

function dashboard(): never
{
    $token = dashboard_token();
    if (!$token) fail(403, 'The dashboard is off: set PETHATCH_STATS_TOKEN or upload stats-token.php.');
    if (!is_string($_GET['token'] ?? null) || !hash_equals($token, $_GET['token'])) fail(403, 'Wrong token.');
    $asked = (int) ($_GET['days'] ?? 90);
    $days = in_array($asked, WINDOWS, true) ? $asked : 90;

    $all = with_counts(fn(array &$c) => $c['days']) ?? [];
    $series = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $day = gmdate('Y-m-d', time() - $i * 86400);
        $series[$day] = $all[$day]['games'] ?? 0;
    }
    $values = array_values($series);
    // Averages only over days since counting began, so a new install doesn't show zeros.
    $counted = count(array_filter(array_keys($series), fn($d) => $d >= ($all ? min(array_keys($all)) : '9999')));
    $avg = fn(int $n) => (int) round(array_sum(array_slice($values, -$n)) / max(1, min($n, $counted)));
    $today = $values[count($values) - 1];
    $yesterday = $values[count($values) - 2] ?? 0;
    $peak = max([0, ...$values]);
    $peakDay = $peak ? array_search($peak, $series, true) : '–';

    $chart = '';
    foreach ($series as $day => $n) {
        $chart .= '<div class="col" title="' . h("$day: $n") . '"><i style="height:' . round(100 * $n / max(1, $peak), 1) . '%"></i></div>';
    }
    // Versions: today's, or yesterday's while only a few games have checked in today.
    $todayKey = gmdate('Y-m-d');
    $yesterdayKey = gmdate('Y-m-d', time() - 86400);
    $versionDay = array_sum($all[$todayKey]['versions'] ?? []) >= 10 || !isset($all[$yesterdayKey]) ? $todayKey : $yesterdayKey;
    $versions = $all[$versionDay]['versions'] ?? [];
    uksort($versions, fn($a, $b) => version_compare($b === 'older' ? '0' : $b, $a === 'older' ? '0' : $a));
    $vmax = max([1, ...array_values($versions)]);
    $versionBars = '';
    foreach ($versions as $v => $n) {
        $versionBars .= '<div class="bar"><span>' . h($v) . '</span><i style="width:' . round(100 * $n / $vmax, 1) . '%"></i><b>' . $n . '</b></div>';
    }
    $versionBars = $versionBars ?: '<p class="muted">Nothing yet.</p>';
    $links = implode(' · ', array_map(
        fn($d) => $d === $days ? "<b>$d days</b>" : '<a href="?view&amp;token=' . h($_GET['token']) . "&amp;days=$d\">$d days</a>",
        WINDOWS,
    ));
    $kpis = [[$today, 'today'], [$yesterday, 'yesterday'], [$avg(7), '7-day average'], [$avg(30), '30-day average']];
    $kpiHtml = implode('', array_map(fn($k) => "<div class=\"kpi\"><b>{$k[0]}</b><span>{$k[1]}</span></div>", $kpis));
    $title = 'Pet Hatch players';

    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    echo <<<HTML
    <!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex"><title>$title</title>
    <style>
      :root { --ink: #2e2a3a; --muted: #6b6478; --bar: #8c76d6; --bg: #f6f2fa; --card: #fff; }
      @media (prefers-color-scheme: dark) { :root { --ink: #ece8f4; --muted: #a8a0b8; --bar: #a993f0; --bg: #1c1a24; --card: #26232f; } }
      body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font: 15px/1.4 system-ui, sans-serif; }
      main { max-width: 760px; margin: 0 auto; display: grid; gap: 14px; }
      section { background: var(--card); border-radius: 16px; padding: 16px; min-width: 0; }
      h1 { margin: 0; font-size: 22px; } h2 { margin: 0 0 10px; font-size: 16px; }
      a { color: var(--bar); } .muted { color: var(--muted); }
      .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
      .kpi b { display: block; font-size: 28px; } .kpi span { color: var(--muted); font-size: 13px; }
      .chart { display: flex; align-items: flex-end; gap: 1px; height: 140px; margin-top: 14px; }
      .col { flex: 1; height: 100%; display: flex; align-items: flex-end; }
      .col i { width: 100%; background: var(--bar); border-radius: 2px 2px 0 0; min-height: 1px; }
      .bar { display: grid; grid-template-columns: 70px 1fr 44px; align-items: center; gap: 8px; margin: 4px 0; }
      .bar i { height: 12px; background: var(--bar); border-radius: 6px; } .bar b { text-align: right; }
    </style></head><body><main>
    <section><h1>$title</h1>
      <p class="muted">Games open per day, counted from the game's update check: each browser and network once a
      day, without cookies or IDs. A household sharing one address counts once; a phone that changes networks may
      count twice. Days are UTC.</p><p>$links</p></section>
    <section><h2>Games open per day</h2><div class="kpis">$kpiHtml</div>
      <div class="chart">$chart</div><p class="muted">One bar per day, the last $days days. Busiest: $peak on $peakDay.</p></section>
    <section><h2>Versions</h2><p class="muted">Games on each version on $versionDay. "older" is a version from
      before the update check named itself.</p>$versionBars</section>
    </main></body></html>
    HTML;
    exit;
}

if (isset($_GET['view'])) dashboard();
$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
if (isset($_GET['check']) || str_ends_with($path, '/version.json')) check();
fail(404, 'Pet Hatch stats: nothing here.');
