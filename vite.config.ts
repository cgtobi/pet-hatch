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

/**
 * Emits sw.js at build time with the full list of built files, so the game works
 * offline after the first visit. The cache name is a hash of everything it caches,
 * so each deploy replaces the old cache.
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
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Pages: fresh from the network when online, cached copy when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./', copy));
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }
  // Built assets have content hashes in their names, so cache-first is safe.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
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
  plugins: [serviceWorker()],
});
