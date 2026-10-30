// @vitest-environment node
/**
 * The PHP player count (server/php/stats.php), run by `npm run test:php` against Apache with PHP, next to the
 * relay tests: PHP_RELAY_URL tells where relay.php is (stats.php sits next to it), PHP_RELAY_DATA its data
 * folder and PHP_STATS_TOKEN the dashboard's token. Skipped otherwise.
 */
import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { describe, expect, it } from 'vitest';

const relay = process.env.PHP_RELAY_URL;
const url = relay?.replace(/relay\.php$/, 'stats.php');
const data = process.env.PHP_RELAY_DATA;
const token = process.env.PHP_STATS_TOKEN;

/** An update check, as a game in this browser would send it (no version.json here, so it answers 404). */
const check = (browser: string, version = '0.4.0') =>
  fetch(`${url}?check&v=${encodeURIComponent(version)}&t=${Date.now()}`, { headers: { 'User-Agent': browser } });
const view = (query: string) => fetch(`${url}?view&${query}`);
const dashboard = async () => (await view(`token=${token}`)).text();
/** The "today" figure on the dashboard. */
const today = (html: string) => Number(/<b>(\d+)<\/b><span>today<\/span>/.exec(html)?.[1]);

describe.skipIf(!url || !token)('PHP player count', () => {
  it('counts each game once a day, however often it checks', async () => {
    const before = today(await dashboard());
    await check('Browser A');
    await check('Browser A');
    await check('Browser A');
    expect(today(await dashboard())).toBe(before + 1);
    await check('Browser B');
    expect(today(await dashboard())).toBe(before + 2);
  });

  it('tells versions apart, and calls anything odd "older"', async () => {
    await check('Browser C', '0.3.16');
    await check('Browser D', '<script>');
    const html = await dashboard();
    expect(html).toMatch(/<span>0\.3\.16<\/span>/);
    expect(html).toMatch(/<span>older<\/span>/);
    expect(html).not.toContain('<script>');
  });

  it('keeps no IP address or browser, only hashes and counts', async () => {
    await check('Very Unique Browser 1.0');
    if (!data) return;
    const stored = readFileSync(joinPath(data, 'players.php'), 'utf8');
    expect(stored.startsWith('<?php exit; ?>')).toBe(true);
    expect(stored).not.toMatch(/(?:\d{1,3}\.){3}\d{1,3}|::1/);
    expect(stored).not.toContain('Unique Browser');
  });

  it('shows the dashboard only with the token', async () => {
    expect((await view('token=wrong-token-123456')).status).toBe(403);
    expect((await view('')).status).toBe(403);
    const page = await view(`token=${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toContain('no-store');
    const html = await page.text();
    expect(html).toContain('Games open per day');
    expect(html).toContain('<b>90 days</b>');
    expect(html).toContain('noindex');
    expect(html).not.toMatch(/Warning|Notice|Deprecated/);
  });
});
