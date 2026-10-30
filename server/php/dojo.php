<?php
/**
 * Dojo matchmaking rules for the PHP relay: how strong a battle code's pet is, and how far apart two ratings may
 * be. The same as server/dojo.mjs (and through it the game's battleRating()); server/php/dojo.test.ts compares
 * them on the same codes. Pure functions; not meant to be opened on its own.
 */

declare(strict_types=1);

/** Stat limits by life stage (child … elder), as in the game. */
const STAT_CAPS = [0, 30, 60, 100, 100];
/** Opponents within this share of your rating at first, widening every 10 s of waiting, up to the most. */
const DOJO_BASE_WINDOW = 0.1;
const DOJO_GROW_WINDOW = 0.05;
const DOJO_MAX_WINDOW = 0.35;
/** Never narrower than this many rating points, so beginners still find each other. */
const DOJO_MIN_POINTS = 8;

function checksum(array $bytes): int
{
    $h = 0x811c9dc5;
    foreach ($bytes as $b) $h = (($h ^ $b) * 0x01000193) & 0xffffffff;
    return ($h ^ ($h >> 8) ^ ($h >> 16) ^ ($h >> 24)) & 0xff;
}

/** The battle rating of a battle code, or null if it isn't a valid one, so nobody can claim a weaker pet. */
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

function match_window(int $rating, int $waitedMs): float
{
    $share = min(DOJO_MAX_WINDOW, DOJO_BASE_WINDOW + DOJO_GROW_WINDOW * floor($waitedMs / 10_000));
    return max(DOJO_MIN_POINTS, $rating * $share);
}

function pair_key(string $x, string $y): string
{
    return $x < $y ? "$x|$y" : "$y|$x";
}
