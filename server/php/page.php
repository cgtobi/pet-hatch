<?php
/**
 * The game page, with its link preview picture at a full address: chat apps read a shared link's page without
 * running it and only show a picture from a full address. The .htaccess next to the game sends requests for the
 * page here; without mod_rewrite index.html is served as it is, and link cards show no picture.
 */

declare(strict_types=1);

$html = @file_get_contents(__DIR__ . '/index.html');
if ($html === false) {
    http_response_code(404);
    exit;
}
$https = (($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off')
    || strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0])) === 'https';
$host = (string) ($_SERVER['HTTP_HOST'] ?? '');
// The game's folder, as the web server sees it (this script sits next to index.html).
$dir = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'))), '/') . '/';
if (preg_match('/^[a-z0-9.-]+(:\d{1,5})?$/i', $host) && preg_match('#^/[\w.~%/-]*$#', $dir)) {
    $base = ($https ? 'https' : 'http') . "://$host$dir";
    $html = str_replace(
        '<meta property="og:image" content="og.jpg" />',
        "<meta property=\"og:image\" content=\"{$base}og.jpg\" />\n    <meta property=\"og:url\" content=\"$base\" />",
        $html,
    );
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
echo $html;
