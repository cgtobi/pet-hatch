/**
 * Runs the live battle and dojo tests against the PHP relay (server/php/relay.php) as well as the Node one,
 * served by Apache with PHP in Docker, like on typical web hosting. Without Docker it falls back to a local
 * `php -S`, whose workers can get stuck behind a long poll, so expect the odd slow test there.
 *
 *   npm run test:php
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 8099;
const root = resolve(import.meta.dirname, '..');
const phpDir = join(root, 'server', 'php');
const hasDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

let stop;
if (hasDocker) {
  const name = `pet-hatch-php-${process.pid}`;
  const run = spawnSync('docker', [
    'run', '--rm', '-d', '--name', name, '-p', `127.0.0.1:${PORT}:80`, '-e', 'PETHATCH_DATA_DIR=/tmp/relay',
    '-v', `${phpDir}:/var/www/html:ro`, 'php:8.3-apache',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (run.status !== 0) process.exit(1);
  stop = () => spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
} else if (spawnSync('php', ['-v']).status === 0) {
  // Long polls each hold a worker, so the built-in server needs several.
  const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', phpDir], {
    env: { ...process.env, PHP_CLI_SERVER_WORKERS: '16', PETHATCH_DATA_DIR: mkdtempSync(join(tmpdir(), 'pet-hatch-php-')) },
    stdio: 'ignore',
  });
  stop = () => php.kill();
} else {
  console.error('Needs Docker or php.');
  process.exit(1);
}

const url = `http://127.0.0.1:${PORT}/relay.php`;
let status = 1;
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${url}?a=health`)).ok) break;
    } catch {
      // Still starting.
    }
    if (i > 50) throw new Error('The PHP relay didn’t start.');
    await new Promise((r) => setTimeout(r, 200));
  }
  // Over HTTP a message takes up to a poll step to arrive, so a whole battle takes a few seconds longer.
  const vitest = spawnSync('npx', ['vitest', 'run', 'src/net', '--testTimeout=60000'], { stdio: 'inherit', env: { ...process.env, PHP_RELAY_URL: url } });
  status = vitest.status ?? 1;
} finally {
  stop();
}
process.exit(status);
