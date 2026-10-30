/**
 * Alerts on the phone while the game is closed ("Pip is calling!"), by web push, only for players who turn them
 * on and only where the server sends them: a push.json next to the game ({ "url": "push.php", "key": "…" })
 * says where to sign up, with the server's public key. Without it the setting doesn't show.
 *
 * Whenever the game is closed it sends the coming alerts (src/sim/alerts.ts) for this phone's push address;
 * opening it clears them. The server gets only those times and their kind; the words, with the pet's name, stay
 * on the phone, where the service worker (vite.config.ts) reads them when an alert arrives.
 */
import type { Alert, AlertKind } from '../sim/alerts';

export interface PushConfig {
  url: string;
  /** The server's public key (VAPID), base64url. */
  key: string;
}

/** What the phone shows for each kind of alert. */
export type AlertTexts = Record<AlertKind, { title: string; body: string }>;

/** Where the service worker finds the words (outside the game's own caches, which each update replaces). */
const TEXT_CACHE = 'pethatch-alerts';

/** Where alerts are signed up, if this server sends them. */
export async function findPush(): Promise<PushConfig | null> {
  try {
    const res = await fetch('./push.json', { cache: 'no-store' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const { url, key } = (await res.json()) as { url?: unknown; key?: unknown };
    if (typeof url !== 'string' || !url || typeof key !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(key)) return null;
    return { url: new URL(url, location.href).toString(), key };
  } catch {
    return null;
  }
}

/**
 * Whether this browser can get alerts: 'yes'; 'install' on an iPhone or iPad until the game is on the Home
 * Screen (Safari only offers push there); 'no' otherwise.
 */
export function pushSupport(ios: boolean, standalone: boolean): 'yes' | 'install' | 'no' {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'yes';
  return ios && !standalone ? 'install' : 'no';
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const text = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** This phone's push address, if alerts are on (the browser keeps it; null if it dropped it or was told to). */
export async function currentSubscription(): Promise<PushSubscriptionJSON | null> {
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription())?.toJSON() ?? null;
}

/** Ask for permission and sign up; null if the player said no (or the browser can't). */
export async function subscribe(config: PushConfig): Promise<PushSubscriptionJSON | null> {
  try {
    if ((await Notification.requestPermission()) !== 'granted') return null;
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.key) }));
    return sub.toJSON();
  } catch {
    return null;
  }
}

/** Turn alerts off: the server forgets this phone, and the browser drops the push address. */
export async function unsubscribe(config: PushConfig): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetch(config.url, { method: 'POST', body: JSON.stringify({ sub: { endpoint: sub.endpoint }, off: true }) });
    await sub.unsubscribe();
  } catch {
    // Offline: the server forgets the phone after a while anyway.
  }
}

/**
 * Replace this phone's alerts on the server (an empty list clears them). Survives the page being closed right
 * after (keepalive), as it is when the game goes to the background.
 */
export function sendAlerts(config: PushConfig, sub: PushSubscriptionJSON, alerts: Alert[]): void {
  const body = JSON.stringify({ sub: { endpoint: sub.endpoint, keys: sub.keys }, alerts });
  fetch(config.url, { method: 'POST', body, keepalive: true }).catch(() => {
    // Offline: the last list stays, and the next one replaces it.
  });
}

/** Leave the words for the service worker, in the player's language and with the pet's name. */
export async function storeAlertTexts(texts: AlertTexts): Promise<void> {
  try {
    const cache = await caches.open(TEXT_CACHE);
    await cache.put('texts', new Response(JSON.stringify(texts), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    // Without them the alert still comes, with a plain text.
  }
}
