/**
 * Puts everything needed to host the game in deploy/ (not tracked), one folder per way of hosting it:
 *
 *   deploy/static/  the game alone, for any static web server (no live battles or dojo)
 *   deploy/php/     the game plus the PHP relay, for web hosting with PHP 8.1+
 *   deploy/node/    the game plus the Node relay, for a server with Node 20+: node server/relay.mjs
 *
 *   npm run deploy   (builds the game first)
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
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
/** @param {string} from @param {string} to */
const copy = (from, to) => cpSync(join(root, from), join(out, to), { recursive: true });

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

copy('dist', 'static');

copy('dist', 'php');
copy('server/php/common.php', 'php/common.php');
copy('server/php/dojo.php', 'php/dojo.php');
copy('server/php/relay.php', 'php/relay.php');
copy('server/php/relay.json', 'php/relay.json');
copy('server/php/stats.php', 'php/stats.php');
copy('server/php/.htaccess', 'php/.htaccess');
copy('server/php/stats.json', 'php/stats.json');
copy('server/php/push.php', 'php/push.php');
copy('server/php/webpush.php', 'php/webpush.php');
// The player count dashboard's token: made once, kept in .stats-token (not tracked), so every deploy keeps the same link.
const tokenFile = join(root, '.stats-token');
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(18).toString('hex') + '\n', { mode: 0o600 });
const statsToken = readFileSync(tokenFile, 'utf8').trim();
writeFileSync(join(out, 'php', 'stats-token.php'), `<?php return '${statsToken}';\n`);
// The alerts' key pair (VAPID): made once, kept in .push-keys (not tracked). A new pair would cut off every phone
// that signed up with the old one, so keep the file. push.json tells the game alerts exist, with the public key.
const keysFile = join(root, '.push-keys');
if (!existsSync(keysFile)) {
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
  const raw = (/** @type {string} */ b64) => Buffer.from(b64, 'base64url');
  const pub = Buffer.concat([Buffer.from([4]), raw(jwk.x ?? ''), raw(jwk.y ?? '')]).toString('base64url');
  writeFileSync(keysFile, JSON.stringify({ public: pub, private: jwk.d }) + '\n', { mode: 0o600 });
}
const pushKeys = JSON.parse(readFileSync(keysFile, 'utf8'));
writeFileSync(join(out, 'php', 'push-key.php'), `<?php return ['public' => '${pushKeys.public}', 'private' => '${pushKeys.private}'];\n`);
writeFileSync(join(out, 'php', 'push.json'), JSON.stringify({ url: 'push.php', key: pushKeys.public }) + '\n');

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
         stats.php keeps stats in three tiers, on one dashboard:
           1. open games per day, from the update check (no cookies, IDs or device storage; .htaccess routes
              version.json through it: needs Apache with mod_rewrite; merge it into an existing .htaccess);
           2. pets that visit the dojo, counted by relay.php from their battle code (hashed, no names);
           3. pet details from players who opt in (stats.json makes the game ask them).
         The dashboard: stats.php?view&token=${statsToken}
         (the token is in stats-token.php and .stats-token; keep it private). Leave out .htaccess or stats.json
         to switch off tier 1 or 3. See README.md › Stats for what to put in your privacy notice.
         push.php sends alerts to players who turn them on ("Pip is calling!"). It needs a cron job every
         minute (* * * * *) that runs either
           php /path/to/push.php tick
         or opens push.php?tick&token=${statsToken}
         Leave out push.json to switch alerts off. Keep push-key.php private; see README.md › Alerts.

node/    Copy the folder to a server with Node 20 or newer and run: PORT=8787 npm start
         It serves the game and the live battle relay on one port. Put it behind an HTTPS reverse proxy
         that passes WebSockets through.
`,
);
console.log(`deploy/ is ready (Pet Hatch ${version}): static/, php/ and node/. See deploy/README.txt.`);
console.log(`Stats dashboard (PHP): stats.php?view&token=${statsToken}`);
console.log(`Alerts cron job (PHP), every minute: push.php?tick&token=${statsToken}  or  php push.php tick`);
