<?php
/**
 * Dojo matchmaking rules for the PHP relay: how strong a battle code's pet is, and how far apart two ratings may
 * be. The same as server/dojo.mjs (and through it the game's battleRating()); server/php/dojo.test.ts compares
 * them on the same codes. Pure functions; not meant to be opened on its own.
 */

declare(strict_types=1);

/** Stat limits by life stage (child … elder), as in the game. */
const STAT_CAPS = [0, 30, 60, 100, 100];
/** Opponents within this share of your rating at first, widening steadily from 10 s into the wait to the most at 40 s. */
const DOJO_BASE_WINDOW = 0.1;
const DOJO_WIDEN_FROM_MS = 10_000;
const DOJO_MAX_WINDOW = 0.35;
const DOJO_WIDEN_UNTIL_MS = 40_000;
/** Never narrower than this many rating points, so beginners still find each other. */
const DOJO_MIN_POINTS = 8;
/** The same two pets aren't matched again within this time. */
const DOJO_REMATCH_MS = 2 * 60_000;
/**
 * With nobody close in strength, two pets that have both waited this long are offered to each other however far
 * apart they are; both must say yes within DOJO_ANSWER_MS. A pair that said no isn't offered again for a while.
 */
const DOJO_OFFER_AFTER_MS = 40_000;
const DOJO_ANSWER_MS = 20_000;
const DOJO_DECLINED_MS = 10 * 60_000;

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
    // In the same order as matchWindow() in server/dojo.mjs, so both relays get the very same number.
    $progress = max(0, min(1, ($waitedMs - DOJO_WIDEN_FROM_MS) / (DOJO_WIDEN_UNTIL_MS - DOJO_WIDEN_FROM_MS)));
    $share = DOJO_BASE_WINDOW + (DOJO_MAX_WINDOW - DOJO_BASE_WINDOW) * $progress;
    return max(DOJO_MIN_POINTS, $rating * $share);
}

function pair_key(string $x, string $y): string
{
    return $x < $y ? "$x|$y" : "$y|$x";
}

/**
 * Pairs among the waiting players ([['id' => player, 'rating', 'joinedAt'], …]), as index pairs: closest ratings
 * first, each within both players' current windows, skipping recent rematches. As findPairs() in server/dojo.mjs.
 */
function find_pairs(array $waiting, int $now, array $recent): array
{
    $candidates = [];
    foreach ($waiting as $i => $a) {
        foreach ($waiting as $j => $b) {
            if ($j <= $i || $a['id'] === $b['id']) continue;
            $diff = abs($a['rating'] - $b['rating']);
            $allowed = min(match_window($a['rating'], $now - $a['joinedAt']), match_window($b['rating'], $now - $b['joinedAt']));
            if ($diff > $allowed) continue;
            if ($now - ($recent[pair_key($a['id'], $b['id'])] ?? PHP_INT_MIN) < DOJO_REMATCH_MS) continue;
            $candidates[] = [$i, $j, $diff];
        }
    }
    return take_closest($candidates);
}

/**
 * Uneven offers, as index pairs: among players that take offers ('offers'), aren't in one already ('offer') and
 * have waited at least $afterMs, the closest pairs however far apart, skipping recent rematches and pairs that
 * turned each other down lately. As findOffers() in server/dojo.mjs.
 */
function find_offers(array $waiting, int $now, array $recent, array $declined, int $afterMs = DOJO_OFFER_AFTER_MS): array
{
    $candidates = [];
    $ready = fn(array $w) => !empty($w['offers']) && empty($w['offer']) && $now - $w['joinedAt'] >= $afterMs;
    foreach ($waiting as $i => $a) {
        foreach ($waiting as $j => $b) {
            if ($j <= $i || !$ready($a) || !$ready($b) || $a['id'] === $b['id']) continue;
            $key = pair_key($a['id'], $b['id']);
            if ($now - ($recent[$key] ?? PHP_INT_MIN) < DOJO_REMATCH_MS) continue;
            if ($now - ($declined[$key] ?? PHP_INT_MIN) < DOJO_DECLINED_MS) continue;
            $candidates[] = [$i, $j, abs($a['rating'] - $b['rating'])];
        }
    }
    return take_closest($candidates);
}

/** Closest first, each player in at most one pair. */
function take_closest(array $candidates): array
{
    // Stable, like JavaScript's sort, so equal gaps pair up the same way on both relays.
    usort($candidates, fn($p, $q) => $p[2] <=> $q[2]);
    $used = [];
    $pairs = [];
    foreach ($candidates as [$i, $j]) {
        if (isset($used[$i]) || isset($used[$j])) continue;
        $used[$i] = $used[$j] = true;
        $pairs[] = [$i, $j];
    }
    return $pairs;
}
