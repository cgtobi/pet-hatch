// @vitest-environment node
/**
 * The PHP relay's protections against misuse, run by `npm run test:php` (which sets PHP_RELAY_URL and
 * PHP_RELAY_DATA, the relay's data folder) against Apache with PHP. Skipped otherwise.
 */
import { readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const url = process.env.PHP_RELAY_URL;
const data = process.env.PHP_RELAY_DATA;

interface Reply {
  id?: string;
  msgs?: [number, string][];
  closed?: boolean;
  gone?: boolean;
}

async function post(body: object): Promise<Reply> {
  const res = await fetch(url!, { method: 'POST', body: JSON.stringify(body) });
  return JSON.parse(await res.text()) as Reply;
}

/** The relay's own messages in a reply (players' messages are whatever they sent). */
const relayMsgs = (r: Reply): { t: string; code?: string; peers?: number }[] =>
  (r.msgs ?? []).flatMap(([, m]) => {
    try {
      return [JSON.parse(m)];
    } catch {
      return [];
    }
  });
const errorOf = (r: Reply) => relayMsgs(r).find((m) => m.t === 'error')?.code;
const room = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');

/** Connections a test opened, left again afterwards so the next test starts with a clean slate. */
let open: string[] = [];
async function join(code: string, role: 'host' | 'guest'): Promise<Reply> {
  const r = await post({ a: 'join', room: code, role });
  if (r.id) open.push(r.id);
  return r;
}
afterEach(async () => {
  await Promise.all(open.map((id) => post({ a: 'leave', id })));
  open = [];
});

describe.skipIf(!url)('PHP relay protections', () => {
  it('answers fields of the wrong type with a plain refusal, never a PHP notice', async () => {
    for (const body of [
      { a: 'join', room: ['x'], role: 'host' },
      { a: 'join', room: 'ABCD', role: { x: 1 } },
      { a: 'dojo', code: 'x', id: ['x'] },
      { a: ['join'] },
      { a: 'poll', id: 'nobody', after: [1] },
    ]) {
      const res = await fetch(url!, { method: 'POST', body: JSON.stringify(body) });
      const text = await res.text();
      expect(text).not.toMatch(/Warning|Notice|\/var\/www|\.php/);
      const reply = JSON.parse(text) as Reply;
      expect(reply.closed || reply.gone).toBe(true);
    }
  });

  it('closes a player who stops reading instead of queueing for them forever', async () => {
    const code = room();
    const host = await join(code, 'host');
    const guest = await join(code, 'guest');
    const big = 'x'.repeat(4000);
    // The guest never polls; 9 × 4 KB is past what the relay queues for it.
    for (let i = 0; i < 9; i++) await post({ a: 'send', id: host.id, msgs: [big] });
    const guestPoll = await post({ a: 'poll', id: guest.id, after: 0 });
    expect(guestPoll.closed).toBe(true);
    expect(errorOf(guestPoll)).toBe('idle');
    // The host hears that it is alone again.
    const hostPoll = await post({ a: 'poll', id: host.id, after: 0 });
    const peers = relayMsgs(hostPoll).filter((m) => m.t === 'room');
    expect(peers.at(-1)?.peers).toBe(1);
  });

  it('answers an older poll at once when a newer one comes in on the same connection', async () => {
    const host = await join(room(), 'host');
    const started = Date.now();
    const first = post({ a: 'poll', id: host.id, after: 99 });
    await new Promise((r) => setTimeout(r, 500));
    const second = post({ a: 'poll', id: host.id, after: 99 });
    expect(await first).toEqual({ msgs: [] });
    // Well before the 8 s a poll would otherwise wait.
    expect(Date.now() - started).toBeLessThan(5000);
    void second;
  });

  it('lets one visitor open only a few connections', async () => {
    const replies = [];
    for (let i = 0; i < 20; i++) replies.push(await join(room(), 'host'));
    const opened = replies.filter((r) => r.id).length;
    expect(opened).toBeGreaterThan(0);
    expect(opened).toBeLessThanOrEqual(16);
    expect(errorOf(replies.at(-1)!)).toBe('busy');
  });

  it.skipIf(!data)('never writes a player’s PHP tag into its state file', async () => {
    const code = room();
    const host = await join(code, 'host');
    const guest = await join(code, 'guest');
    const sneaky = "<?php echo 'ran'; ?>";
    await post({ a: 'send', id: host.id, msgs: [sneaky] });
    const state = readFileSync(joinPath(data!, 'state.php'), 'utf8');
    expect(state.split('<?php').length).toBe(2); // only the guard at the top
    // It still arrives exactly as sent.
    const got = await post({ a: 'poll', id: guest.id, after: 0 });
    expect(got.msgs!.map(([, m]) => m)).toContain(sneaky);
  });

  // Last: afterwards this visitor is turned away from rooms for ten minutes.
  it('turns a visitor away for a while after too many wrong room codes', async () => {
    const replies = [];
    for (let i = 0; i < 11; i++) replies.push(errorOf(await join(room(), 'guest')));
    expect(replies.slice(0, 10).every((code) => code === 'no-room')).toBe(true);
    expect(replies[10]).toBe('busy');
  });
});
