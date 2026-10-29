/**
 * Puts everything needed to host the game in deploy/ (not tracked), one folder per way of hosting it:
 *
 *   deploy/static/  the game alone, for any static web server (no live battles or dojo)
 *   deploy/php/     the game plus the PHP relay, for web hosting with PHP 8.1+
 *   deploy/node/    the game plus the Node relay, for a server with Node 20+: node server/relay.mjs
 *
 *   npm run deploy   (builds the game first)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const out = join(root, 'deploy');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('Build the game first: npm run build');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const copy = (from, to) => cpSync(join(root, from), join(out, to), { recursive: true });

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

copy('dist', 'static');

copy('dist', 'php');
copy('server/php/relay.php', 'php/relay.php');
copy('server/php/relay.json', 'php/relay.json');

// As in the Docker image: the relay's only dependency is ws, which has none of its own.
copy('dist', 'node/dist');
for (const file of ['relay.mjs', 'dojo.mjs']) copy(`server/${file}`, `node/server/${file}`);
copy('node_modules/ws', 'node/node_modules/ws');
writeFileSync(
  join(out, 'node', 'package.json'),
  JSON.stringify({ name: 'pet-hatch', version, private: true, scripts: { start: 'node server/relay.mjs' } }, null, 2) + '\n',
);

writeFileSync(
  join(out, 'README.txt'),
  `Pet Hatch ${version}, ready to host. Serve it over HTTPS so it can be installed as an app.

static/  Upload the contents to any static web server. Everything works except live battles and the dojo.

php/     Upload the contents to web hosting with PHP 8.1 or newer. Live battles and the dojo go through
         relay.php, which keeps its state in a relay-data/ folder it creates next to itself, so PHP must be
         allowed to write there (or set PETHATCH_DATA_DIR to another folder).

node/    Copy the folder to a server with Node 20 or newer and run: PORT=8787 npm start
         It serves the game and the live battle relay on one port. Put it behind an HTTPS reverse proxy
         that passes WebSockets through.
`,
);
console.log(`deploy/ is ready (Pet Hatch ${version}): static/, php/ and node/. See deploy/README.txt.`);
