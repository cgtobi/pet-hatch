<?php
/**
 * Shared by relay.php, stats.php and push.php: the data folder, its guarded JSON files and who is asking.
 * Not meant to be opened on its own (it does nothing then).
 */

declare(strict_types=1);

/** Data files are PHP, so a web server that hands out the data folder only ever shows an empty page. */
const GUARD = "<?php exit; ?>\n";
/** < and > escaped, so nothing in a data file can ever open a PHP tag, whatever players send. */
const DATA_JSON = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG;

/** The data folder can't be created, read or written. */
final class DataUnavailable extends RuntimeException
{
}

/** The data folder (relay-data/ next to the scripts, or PETHATCH_DATA_DIR), created on first use. */
function data_dir(): string
{
    $dir = getenv('PETHATCH_DATA_DIR') ?: __DIR__ . '/relay-data';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        error_log("Pet Hatch: can’t create the data folder $dir");
        throw new DataUnavailable($dir);
    }
    if (!file_exists("$dir/.htaccess")) @file_put_contents("$dir/.htaccess", "Require all denied\n");
    return $dir;
}

/** A data file's contents (null if it doesn't exist yet). Safe without a lock: files are only ever replaced whole. */
function read_data(string $name): mixed
{
    $file = data_dir() . "/$name";
    $text = is_file($file) ? (string) @file_get_contents($file) : '';
    return json_decode(substr($text, strlen(GUARD)), true);
}

/**
 * Change a data file, one request at a time: $fn gets the contents by reference (null for a new file) and its
 * result is returned. A separate lock file keeps requests in turn; the new contents go to a temporary file that
 * then replaces the old one in one step, so a crash or a full disk never leaves a file empty or half written.
 * Nothing is written when nothing changed.
 */
function with_data(string $name, callable $fn): mixed
{
    $dir = data_dir();
    $file = "$dir/$name";
    $lock = @fopen("$file.lock", 'c');
    if (!$lock || !flock($lock, LOCK_EX)) {
        error_log("Pet Hatch: can’t lock $file");
        throw new DataUnavailable($file);
    }
    try {
        $old = is_file($file) ? (string) @file_get_contents($file) : '';
        $data = json_decode(substr($old, strlen(GUARD)), true);
        $result = $fn($data);
        $new = GUARD . json_encode($data, DATA_JSON);
        if ($new !== $old) {
            $tmp = "$file." . bin2hex(random_bytes(6)) . '.tmp';
            if (@file_put_contents($tmp, $new) !== strlen($new) || !@rename($tmp, $file)) {
                @unlink($tmp);
                error_log("Pet Hatch: can’t write $file");
                throw new DataUnavailable($file);
            }
        }
        return $result;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/**
 * A stamp that changes whenever a data file is replaced, to tell cheaply whether it's worth reading again.
 */
function data_stamp(string $name): string
{
    $file = data_dir() . "/$name";
    clearstatcache(true, $file);
    $st = @stat($file);
    return $st ? "{$st['ino']}:{$st['mtime']}:{$st['size']}" : '';
}

/**
 * Who is asking, for limits and counts: the IP address, an IPv6 one cut to its /64 network. A home connection or
 * phone gets a whole /64 and can pick any address in it, so full IPv6 addresses would let one visitor be many.
 */
function visitor_address(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    $bin = @inet_pton($ip);
    if ($bin === false) return $ip;
    if (strlen($bin) === 16 && substr($bin, 0, 12) !== str_repeat("\0", 10) . "\xff\xff") {
        return bin2hex(substr($bin, 0, 8)) . '::/64';
    }
    return inet_ntop(substr($bin, -4)) ?: $ip;
}

/** A visitor as a salted hash (never the address itself). */
function visitor_hash(string $salt): string
{
    return substr(hash('sha256', $salt . '|' . visitor_address()), 0, 16);
}

/**
 * The owner's secret token: it opens the stats dashboard and lets a cron job run push.php's tick over the web.
 * From PETHATCH_STATS_TOKEN, or stats-token.php next to the scripts (written by npm run deploy); null without one.
 */
function dashboard_token(): ?string
{
    $token = getenv('PETHATCH_STATS_TOKEN') ?: null;
    if (!$token && is_file(__DIR__ . '/stats-token.php')) $token = include __DIR__ . '/stats-token.php';
    return is_string($token) && strlen($token) >= 16 ? $token : null;
}
