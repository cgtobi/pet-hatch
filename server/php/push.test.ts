// @vitest-environment node
/**
 * The PHP alerts (server/php/push.php), run by `npm run test:php` against Apache with PHP: PHP_RELAY_URL tells
 * where relay.php is (push.php sits next to it), PHP_RELAY_DATA its data folder, PHP_STATS_TOKEN the tick's token,
 * PHP_PUSH_PUBLIC_KEY the server's push key, and PHP_PUSH_ORIGIN where the server reaches the stand-in push
 * service this test runs on PHP_PUSH_SERVICE_PORT. Skipped otherwise.
 *
 * Messages are decrypted here with Node's own HKDF and AES, apart from webpush.php, and its encryption is also
 * checked against the worked example in RFC 8291 (through check-push.php, PHP_CHECK_PUSH).
 */
import { spawnSync } from 'node:child_process';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join as joinPath } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const relay = process.env.PHP_RELAY_URL;
const url = relay?.replace(/relay\.php$/, 'push.php');
const data = process.env.PHP_RELAY_DATA;
const token = process.env.PHP_STATS_TOKEN;
const serverKey = process.env.PHP_PUSH_PUBLIC_KEY;
const origin = process.env.PHP_PUSH_ORIGIN;
const port = Number(process.env.PHP_PUSH_SERVICE_PORT);
const checkPush = process.env.PHP_CHECK_PUSH ? (JSON.parse(process.env.PHP_CHECK_PUSH) as string[]) : null;

interface Received {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/** The stand-in push service: records every message, and answers with `status[path]` (201 by default). */
const received: Received[] = [];
const status: Record<string, number> = {};
let service: Server;

/** A phone: its push address on the stand-in service, and its keys. */
function phone(name: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `${origin}/push/${name}`;
  return {
    endpoint,
    path: `/push/${name}`,
    sub: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
    /** RFC 8291, the receiving side. */
    decrypt(body: Buffer): unknown {
      const salt = body.subarray(0, 16);
      const idLength = body[20];
      const serverPublic = body.subarray(21, 21 + idLength);
      const sealed = body.subarray(21 + idLength);
      const ecdhSecret = ecdh.computeSecret(serverPublic);
      const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverPublic]);
      const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, auth, keyInfo, 32));
      const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
      const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
      decipher.setAuthTag(sealed.subarray(-16));
      const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
      // One record: the message, then the 0x02 delimiter (and any zero padding).
      return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
    },
  };
}

const post = (body: unknown) => fetch(url!, { method: 'POST', body: JSON.stringify(body) });
const tick = async (t = token) => {
  const res = await fetch(`${url}?tick&token=${t}`);
  return { status: res.status, text: (await res.text()).trim() };
};
const stored = () => readFileSync(joinPath(data!, 'push-alerts.php'), 'utf8');
const MIN = 60_000;

describe.skipIf(!url || !origin)('PHP alerts (push.php)', () => {
  beforeAll(async () => {
    service = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(status[req.url ?? ''] ?? 201).end();
      });
    });
    await new Promise<void>((done) => service.listen(port, done));
  });
  afterAll(() => new Promise<void>((done) => service.close(() => done())));

  it('sends an alert when it is due, encrypted for the phone and signed by the server', async () => {
    const p = phone('pip');
    const now = Date.now();
    expect((await post({ sub: p.sub, alerts: [[now - MIN, 'call'], [now + 60 * MIN, 'egg']] })).status).toBe(204);
    expect(await tick()).toEqual({ status: 200, text: 'sent 1, failed 0, gone 0' });

    const got = received.filter((r) => r.path === p.path);
    expect(got).toHaveLength(1);
    const { headers, body } = got[0];
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers.ttl).toBe('1800');
    expect(headers.urgency).toBe('high');
    expect(p.decrypt(body)).toEqual({ kind: 'call', at: now - MIN });

    // Signed with the server's key, for this push service, and not for long.
    const [, jwt, key] = /^vapid t=([^,]+), k=(.+)$/.exec(String(headers.authorization)) ?? [];
    expect(key).toBe(serverKey);
    const [head, claims, signature] = jwt.split('.');
    const raw = Buffer.from(key, 'base64url');
    const publicKey = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') },
      format: 'jwk',
    });
    const signed = { key: publicKey, dsaEncoding: 'ieee-p1363' as const };
    expect(verify('sha256', Buffer.from(`${head}.${claims}`), signed, Buffer.from(signature, 'base64url'))).toBe(true);
    const c = JSON.parse(Buffer.from(claims, 'base64url').toString());
    expect(c.aud).toBe(origin);
    expect(c.exp * 1000).toBeGreaterThan(now);
    expect(c.exp * 1000).toBeLessThanOrEqual(now + 24 * 60 * MIN);
    expect(c.sub).toMatch(/^https:\/\//);

    // Sent once only; the later one waits for its time.
    expect((await tick()).text).toBe('sent 0, failed 0, gone 0');
    expect(stored()).toContain(String(now + 60 * MIN));
  });

  it('replaces the list each time, and an empty one clears it', async () => {
    const p = phone('clear');
    const now = Date.now();
    await post({ sub: p.sub, alerts: [[now - MIN, 'egg']] });
    await post({ sub: p.sub, alerts: [] });
    await tick();
    expect(received.filter((r) => r.path === p.path)).toHaveLength(0);
  });

  it('forgets a phone when its push address is gone, or when alerts are turned off', async () => {
    const gone = phone('gone');
    status[gone.path] = 410;
    await post({ sub: gone.sub, alerts: [[Date.now() - MIN, 'hatch']] });
    expect((await tick()).text).toBe('sent 0, failed 0, gone 1');
    expect(stored()).not.toContain(gone.endpoint);

    const off = phone('off');
    await post({ sub: off.sub, alerts: [[Date.now() + MIN, 'call']] });
    expect(stored()).toContain(off.endpoint);
    expect((await post({ sub: { endpoint: off.endpoint }, off: true })).status).toBe(204);
    expect(stored()).not.toContain(off.endpoint);
  });

  it('turns away other addresses and anything malformed', async () => {
    const p = phone('bad');
    const now = Date.now();
    const bad = async (body: unknown) => (await post(body)).status;
    // Only push services: never anywhere else on the internet, or on the server's own network.
    expect(await bad({ sub: { ...p.sub, endpoint: 'https://example.com/push/x' }, alerts: [] })).toBe(400);
    expect(await bad({ sub: { ...p.sub, endpoint: 'http://fcm.googleapis.com/fcm/send/x' }, alerts: [] })).toBe(400);
    expect(await bad({ sub: { ...p.sub, endpoint: 'https://fcm.googleapis.com.evil.example/x' }, alerts: [] })).toBe(400);
    expect(await bad({ sub: { ...p.sub, endpoint: 'http://127.0.0.1/x' }, alerts: [] })).toBe(400);
    expect(await bad({ sub: p.sub, alerts: [[now, 'dinner']] })).toBe(400);
    expect(await bad({ sub: p.sub, alerts: [[now + 30 * 24 * 60 * MIN, 'call']] })).toBe(400);
    expect(await bad({ sub: p.sub, alerts: Array.from({ length: 17 }, (_, i) => [now + i * MIN, 'call']) })).toBe(400);
    expect(await bad({ sub: { ...p.sub, keys: { p256dh: 'AAAA', auth: p.sub.keys.auth } }, alerts: [] })).toBe(400);
    expect(await bad({ sub: p.sub, alerts: 'soon' })).toBe(400);
    expect(await bad('x'.repeat(5000))).toBe(413);
    expect(stored()).not.toContain(p.endpoint);
  });

  it('only runs the tick with the token', async () => {
    expect((await fetch(`${url}?tick`)).status).toBe(403);
    expect((await tick('wrong-token-wrong-token')).status).toBe(403);
  });

  it('encrypts exactly like the worked example in RFC 8291', () => {
    if (!checkPush) return;
    const [cmd, ...args] = checkPush;
    const input = {
      encrypt: {
        payload: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
        uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
        asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
        asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
        salt: 'DGv6ra1nlYgDCS1FRnbzlw',
      },
    };
    const run = spawnSync(cmd, args, { input: JSON.stringify(input), encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const header =
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
    const ciphertext = '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ';
    const expected = Buffer.concat([Buffer.from(header, 'base64url'), Buffer.from(ciphertext, 'base64url')]);
    expect(Buffer.from(JSON.parse(run.stdout).encrypted, 'base64url').equals(expected)).toBe(true);
  });

  // Last: it fills this visitor's phones up to the limit.
  it('signs up only so many phones from one visitor', async () => {
    let made = 0;
    for (let i = 0; i < 25; i++) {
      const res = await post({ sub: phone(`many-${i}`).sub, alerts: [] });
      if (res.status === 429) break;
      expect(res.status).toBe(204);
      made++;
    }
    expect(made).toBeGreaterThan(10);
    expect(made).toBeLessThan(20);
    // An existing phone can still update its alerts.
    expect((await post({ sub: phone('many-0').sub, alerts: [] })).status).toBe(204);
  });
});
