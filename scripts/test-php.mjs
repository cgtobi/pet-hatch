/**
 * Runs the live battle and dojo tests against the PHP relay (server/php/relay.php) as well as the Node one,
 * then the PHP relay's own protection tests (server/php/relay.test.ts), the player count tests
 * (server/php/stats.test.ts) and the alert tests (server/php/push.test.ts). Served by Apache with PHP in Docker,
 * like on typical web hosting. Without Docker it falls back to a local `php -S`, whose workers can get stuck
 * behind a long poll, so expect the odd slow test there.
 *
 *   npm run test:php
 */
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 8099;
/** Where push.test.ts runs a stand-in push service for push.php to send to. */
const PUSH_PORT = 8098;
const root = resolve(import.meta.dirname, '..');
const phpDir = join(root, 'server', 'php');
const hasDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const url = `http://127.0.0.1:${PORT}/relay.php`;

if (!hasDocker && spawnSync('php', ['-v']).status !== 0) {
  console.error('Needs Docker or php.');
  process.exit(1);
}

/**
 * Start the relay with a fresh data folder and these settings; returns the folder and how to stop it.
 * @param {Record<string, string>} env
 */
async function start(env) {
  const data = mkdtempSync(join(tmpdir(), 'pet-hatch-php-'));
  chmodSync(data, 0o777);
  let stop;
  if (hasDocker) {
    const name = `pet-hatch-php-${process.pid}`;
    const vars = Object.entries({ ...env, PETHATCH_DATA_DIR: '/data' }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    const run = spawnSync('docker', [
      'run', '--rm', '-d', '--name', name, '-p', `127.0.0.1:${PORT}:80`, '--add-host=host.docker.internal:host-gateway', ...vars,
      '-v', `${phpDir}:/var/www/html:ro`, '-v', `${data}:/data`, 'php:8.3-apache',
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    if (run.status !== 0) process.exit(1);
    stop = () => spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  } else {
    // Long polls each hold a worker, so the built-in server needs several.
    const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', phpDir], {
      env: { ...process.env, ...env, PHP_CLI_SERVER_WORKERS: '16', PETHATCH_DATA_DIR: data },
      stdio: 'ignore',
    });
    stop = () => php.kill();
  }
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${url}?a=health`)).ok) break;
    } catch {
      // Still starting.
    }
    if (i > 50) {
      stop();
      throw new Error('The PHP relay didn’t start.');
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { data, stop };
}

/** @param {string[]} args @param {Record<string, string>} env */
function vitest(args, env) {
  return spawnSync('npx', ['vitest', 'run', ...args], { stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;
}

let status = 0;
// The game's tests all come from one address, so the per-visitor limit is off for them.
// Uneven dojo offers come after 1.5 s here instead of 40 s, as in src/net/dojo.test.ts.
let relay = await start({ PETHATCH_MAX_PER_IP: '0', PETHATCH_DOJO_OFFER_AFTER_MS: '1500' });
try {
  // Over HTTP a message takes up to a poll step to arrive, so a whole battle takes a few seconds longer.
  status ||= vitest(['src/net', '--testTimeout=60000'], { PHP_RELAY_URL: url });
} finally {
  relay.stop();
}
const statsToken = 'test-token-0123456789';
// The PHP dojo rules are also compared with the Node ones directly, through the PHP command line.
const checkDojo = hasDocker
  ? ['docker', 'run', '--rm', '-i', '-v', `${phpDir}:/app:ro`, 'php:8.3-cli', 'php', '/app/check-dojo.php']
  : ['php', join(phpDir, 'check-dojo.php')];
// The alerts' key pair, and the stand-in push service on this machine, as the server sees it.
const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
const pushPublic = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x ?? '', 'base64url'), Buffer.from(jwk.y ?? '', 'base64url')]).toString('base64url');
const pushOrigin = `http://${hasDocker ? 'host.docker.internal' : '127.0.0.1'}:${PUSH_PORT}`;
const checkPush = hasDocker
  ? ['docker', 'run', '--rm', '-i', '-v', `${phpDir}:/app:ro`, 'php:8.3-cli', 'php', '/app/check-push.php']
  : ['php', join(phpDir, 'check-push.php')];
relay = await start({
  PETHATCH_STATS_TOKEN: statsToken,
  PETHATCH_PUSH_PUBLIC_KEY: pushPublic,
  PETHATCH_PUSH_PRIVATE_KEY: jwk.d ?? '',
  PETHATCH_PUSH_TEST_ORIGIN: pushOrigin,
});
try {
  status ||= vitest(['server/php'], {
    PHP_RELAY_URL: url,
    PHP_RELAY_DATA: relay.data,
    PHP_STATS_TOKEN: statsToken,
    PHP_CHECK_DOJO: JSON.stringify(checkDojo),
    PHP_CHECK_PUSH: JSON.stringify(checkPush),
    PHP_PUSH_PUBLIC_KEY: pushPublic,
    PHP_PUSH_ORIGIN: pushOrigin,
    PHP_PUSH_SERVICE_PORT: String(PUSH_PORT),
  });
} finally {
  relay.stop();
}
process.exit(status);
