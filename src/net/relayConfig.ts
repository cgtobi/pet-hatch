/**
 * Where the live battle relay is, if anywhere:
 * 1. VITE_RELAY_URL at build time (e.g. wss://battles.example.com/relay, or /relay on the same host);
 * 2. otherwise ./relay.json next to the game, which the bundled relay server serves automatically
 *    (or which you can drop into any static host): { "url": "wss://…/relay" }, or for the PHP relay
 *    { "url": "relay.php", "transport": "http" }.
 * Without either, live battles are hidden and everything else works as before.
 */
export async function findRelay(): Promise<string | null> {
  let url: string | undefined = import.meta.env.VITE_RELAY_URL;
  let transport: string | undefined;
  if (!url) {
    try {
      const res = await fetch('./relay.json', { cache: 'no-store' });
      if (res.ok && res.headers.get('content-type')?.includes('json')) {
        ({ url, transport } = (await res.json()) as { url?: string; transport?: string });
      }
    } catch {
      // Offline or no relay.json: no live battles.
    }
  }
  if (!url) return null;
  const relay = new URL(url, location.href);
  // The PHP relay works over plain HTTP (an http(s) URL tells the game so); everything else is a WebSocket.
  if (transport === 'http' || relay.pathname.endsWith('.php')) return relay.toString();
  if (relay.protocol === 'http:') relay.protocol = 'ws:';
  if (relay.protocol === 'https:') relay.protocol = 'wss:';
  return relay.toString();
}
