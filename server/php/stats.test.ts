// @vitest-environment node
/**
 * The PHP stats (server/php/stats.php, and the dojo count in relay.php), run by `npm run test:php` against Apache
 * with PHP, next to the relay tests: PHP_RELAY_URL tells where relay.php is (stats.php sits next to it),
 * PHP_RELAY_DATA its data folder and PHP_STATS_TOKEN the dashboard's token. Skipped otherwise.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Fighter } from '../../src/sim/battle';
import { encodeFighter } from '../../src/sim/battlecode';

const relay = process.env.PHP_RELAY_URL;
const url = relay?.replace(/relay\.php$/, 'stats.php');
const data = process.env.PHP_RELAY_DATA;
const token = process.env.PHP_STATS_TOKEN;

const dashboard = async (query = '') => (await fetch(`${url}?view&token=${token}${query}`)).text();
/** A KPI on the dashboard, by its label, in the given tier's section (1, 2 or 3). */
const kpi = (html: string, tier: number, label: string) => {
  const section = html.split('class="tier"')[tier] ?? '';
  return Number(new RegExp(`<b>(\\d+)</b><span>${label}</span>`).exec(section)?.[1]);
};

/** 1. An update check, as a game in this browser would send it (no version.json here, so it answers 404). */
const check = (browser: string, version = '0.4.0') =>
  fetch(`${url}?check&v=${encodeURIComponent(version)}&t=${Date.now()}`, { headers: { 'User-Agent': browser } });

/** 2. Joining the dojo with a pet, then leaving again. */
async function visitDojo(f: Partial<Fighter>): Promise<void> {
  const fighter: Fighter = {
    name: 'Pip',
    type: 'ember',
    form: 'teen.physical',
    stage: 2,
    stats: { power: 20, speed: 10, guard: 10, wits: 5 },
    discipline: 50,
    teen: 'teen.physical',
    seed: 1234,
    wild: false,
    ...f,
  };
  const id = `p${Math.random().toString(36).slice(2, 12)}`;
  const res = await fetch(relay!, { method: 'POST', body: JSON.stringify({ a: 'dojo', code: encodeFighter(fighter), id }) });
  const reply = (await res.json()) as { id?: string };
  if (reply.id) await fetch(relay!, { method: 'POST', body: JSON.stringify({ a: 'leave', id: reply.id }) });
}

/** 3. An opt-in pet snapshot. */
const snap = (over: object = {}) => ({
  pet: 'a1b2c3d4e5f6a7',
  v: '0.4.0',
  phase: 'pet',
  stage: 3,
  type: 'ember',
  form: 'adult.power',
  mode: 'gentle',
  gen: 2,
  status: 'alive',
  stars: 1,
  ...over,
});
const send = (body: unknown) =>
  fetch(url!, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe.skipIf(!url || !token)('PHP stats', () => {
  it('1: counts each open game once a day, however often it checks, by version', async () => {
    const before = kpi(await dashboard(), 1, 'today');
    await check('Browser A');
    await check('Browser A');
    await check('Browser A', '0.3.16');
    expect(kpi(await dashboard(), 1, 'today')).toBe(before + 1);
    await check('Browser B', '<script>');
    const html = await dashboard();
    expect(kpi(html, 1, 'today')).toBe(before + 2);
    expect(html).toMatch(/<span>older<\/span>/);
    expect(html).not.toContain('<script>');
  });

  it('2: counts a dojo pet once a day however it grows, and tells pets apart', async () => {
    const before = kpi(await dashboard(), 2, 'today');
    await visitDojo({ seed: 4242, name: 'Mochi' });
    await visitDojo({ seed: 4242, name: 'Mochi', stage: 3, form: 'adult.power', stats: { power: 40, speed: 20, guard: 20, wits: 10 } });
    expect(kpi(await dashboard(), 2, 'today')).toBe(before + 1);
    await visitDojo({ seed: 4242, name: 'Bean' });
    await visitDojo({ seed: 4243, name: 'Mochi' });
    expect(kpi(await dashboard(), 2, 'today')).toBe(before + 3);
  });

  it('3: takes an opt-in snapshot and turns away anything else', async () => {
    expect((await send(snap())).status).toBe(204);
    expect((await send(snap({ phase: 'egg', stage: 2, type: null, form: null, pet: 'ffffffffffff00' }))).status).toBe(204);
    for (const bad of [
      'not json',
      snap({ pet: 'Robert' }),
      snap({ stage: 9 }),
      snap({ type: 'fire' }),
      snap({ form: '<script>' }),
      snap({ status: 'hacked' }),
      snap({ phase: 'egg' }),
      snap({ name: 'x'.repeat(600) }),
    ]) {
      expect([400, 413]).toContain((await send(bad)).status);
    }
  });

  it('3: follows an opted-in pet through its stages to its ending', async () => {
    const id = 'feedfacefeed01';
    await send(snap({ pet: id, phase: 'egg', stage: 0, type: null, form: null }));
    await send(snap({ pet: id, stage: 0, form: 'baby' }));
    await send(snap({ pet: id, stage: 2, form: 'teen.physical', status: 'ranAway' }));
    const html = await dashboard('&days=30');
    expect(html).toMatch(/<th>Gentle<\/th><td>\d+<\/td><td>[1-9]/);
  });

  it('keeps no IP address, browser or pet name anywhere', async () => {
    await check('Very Unique Browser 1.0');
    await visitDojo({ name: 'Zebedee' });
    if (!data) return;
    const files = readdirSync(data).filter((f) => f.endsWith('.php') && f !== 'state.php');
    expect(files).toEqual(expect.arrayContaining(['players.php', 'dojo-pets.php', 'stats-limits.php']));
    for (const file of files) {
      const text = readFileSync(joinPath(data, file), 'utf8');
      expect(text.startsWith('<?php exit; ?>')).toBe(true);
      expect(text).not.toMatch(/(?:\d{1,3}\.){3}\d{1,3}|::1/);
      expect(text).not.toContain('Unique Browser');
      expect(text).not.toContain('Zebedee');
      expect(text).not.toContain('Mochi');
    }
  });

  it('shows the dashboard only with the token', async () => {
    expect((await fetch(`${url}?view&token=wrong-token-123456`)).status).toBe(403);
    expect((await fetch(`${url}?view`)).status).toBe(403);
    const page = await fetch(`${url}?view&token=${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toContain('no-store');
    const html = await page.text();
    for (const part of ['Games open per day', 'Dojo pets per day', 'Opted-in pets per day', 'How far pets get', '<b>90 days</b>']) {
      expect(html).toContain(part);
    }
    expect(html).not.toMatch(/Warning|Notice|Deprecated|Fatal/);
  });

  it('3: limits how much one visitor can send in a day', async () => {
    const replies = [];
    for (let i = 0; i < 210; i++) replies.push((await send(snap({ pet: i.toString(16).padStart(14, '0') }))).status);
    expect(replies).toContain(429);
  });
});
