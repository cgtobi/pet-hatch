import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const APP_VERSION: string = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8')).version;

/**
 * Emits sw.js at build time with the full list of built files, so the game works
 * offline after the first visit. The cache name is a hash of everything it caches,
 * so each deploy replaces the old cache. Also emits version.json, which an open game
 * checks to offer a reload when a newer deploy is out (src/update.ts).
 */
function serviceWorker(): Plugin {
  return {
    name: 'pet-hatch-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const hash = createHash('sha256');
      const publicDir = join(import.meta.dirname, 'public');
      const publicFiles = listFiles(publicDir).map((p) => {
        hash.update(readFileSync(p));
        return relative(publicDir, p).split('\\').join('/');
      });
      // Old browsers that need .woff can still fetch it online; precache only .woff2.
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.woff')).sort();
      hash.update(built.join('\n'));
      const files = ['./', ...built, ...publicFiles].map((f) => (f === './' ? f : `./${f}`));
      const version = hash.digest('hex').slice(0, 12);
      const entry = Object.values(bundle).find((f) => f.type === 'chunk' && f.isEntry)?.fileName ?? '';
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: APP_VERSION, entry: entry.split('/').pop() }),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Generated at build time by vite.config.ts.
const CACHE = 'pet-hatch-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pet-hatch-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // The update check always asks the server.
  if (url.pathname.endsWith('/version.json')) return;
  if (request.mode === 'navigate') {
    // Pages: fresh from the network when online, cached copy when offline. Only the game page itself, and only
    // a good answer, replaces the copy: never an error page or another page on the same server.
    const page = new URL('./', self.registration.scope).pathname;
    const isGame = url.pathname === page || url.pathname === page + 'index.html';
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isGame && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./', copy));
          }
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }
  // Built assets have content hashes in their names, so cache-first is safe.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});

// Alerts (src/net/push.ts): the message only says which kind; the words, with the pet's name, were left by the
// game in its own cache, in the player's language.
self.addEventListener('push', (event) => {
  let kind = 'call';
  try {
    kind = event.data?.json().kind || kind;
  } catch {
    // Not one of ours: still show something, as browsers require.
  }
  event.waitUntil(
    caches.open('pethatch-alerts')
      .then((cache) => cache.match('texts'))
      .then((hit) => (hit ? hit.json() : {}))
      .catch(() => ({}))
      .then((texts) => {
        const text = texts[kind] || texts.call || { title: 'Pet Hatch', body: '' };
        return self.registration.showNotification(text.title, {
          body: text.body,
          icon: './app-icons/icon-192.png',
          // One at a time: a newer alert replaces an older one still showing.
          tag: 'pet-hatch',
          renotify: true,
        });
      }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
      const game = open.find((c) => 'focus' in c);
      return game ? game.focus() : self.clients.openWindow('./');
    }),
  );
});
`,
      });
    },
  };
}

// Relative base so the built dist/ works from any folder on any web server.
export default defineConfig({
  base: './',
  // In development, /relay goes to the live battle relay (npm run relay) on port 8787.
  server: { proxy: { '/relay': { target: 'ws://localhost:8787', ws: true } } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
  // Shown at the bottom of Settings.
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [serviceWorker()],
});
