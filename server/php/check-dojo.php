<?php
/**
 * For server/php/dojo.test.ts only (never deployed): reads {"codes": [...], "windows": [[rating, waitedMs], ...],
 * "scenes": [{waiting, now, recent, declined}, ...]} on stdin and prints what dojo.php makes of them, as JSON.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/dojo.php';

$in = json_decode((string) stream_get_contents(STDIN), true);
echo json_encode([
    'ratings' => array_map('rating_from_code', $in['codes']),
    'windows' => array_map(fn($w) => match_window($w[0], $w[1]), $in['windows']),
    'pairs' => array_map(fn($c) => find_pairs($c['waiting'], $c['now'], $c['recent'] ?: []), $in['scenes'] ?? []),
    'offers' => array_map(fn($c) => find_offers($c['waiting'], $c['now'], $c['recent'] ?: [], $c['declined'] ?: []), $in['scenes'] ?? []),
]);
