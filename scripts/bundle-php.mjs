/**
 * Puts the built game and the PHP relay together in dist-php/, ready to upload to any web host with PHP 8.1+:
 * the game, relay.php, and a relay.json that points the game at it.
 *
 *   npm run build:php
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const out = join(root, 'dist-php');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('Build the game first: npm run build');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(dist, out, { recursive: true });
for (const file of ['relay.php', 'relay.json']) cpSync(join(root, 'server', 'php', file), join(out, file));
console.log('dist-php/ is ready: upload its contents to your web host.');
