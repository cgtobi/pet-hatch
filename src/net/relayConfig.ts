/**
 * Where the live battle relay is, if anywhere:
 * 1. VITE_RELAY_URL at build time (e.g. wss://battles.example.com/relay, or /relay on the same host);
 * 2. otherwise ./relay.json next to the game, which the bundled relay server serves automatically
 *    (or which you can drop into any static host): { "url": "wss://…/relay" }.
 * Without either, live battles are hidden and everything else works as before.
 */
export async function findRelay(): Promise<string | null> {
  let url: string | undefined = import.meta.env.VITE_RELAY_URL;
  if (!url) {
    try {
      const res = await fetch('./relay.json', { cache: 'no-store' });
      if (res.ok && res.headers.get('content-type')?.includes('json')) url = ((await res.json()) as { url?: string }).url;
    } catch {
      // Offline or no relay.json: no live battles.
    }
  }
  if (!url) return null;
  const ws = new URL(url, location.href);
  if (ws.protocol === 'http:') ws.protocol = 'ws:';
  if (ws.protocol === 'https:') ws.protocol = 'wss:';
  return ws.toString();
}
