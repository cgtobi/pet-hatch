/**
 * Notices when a newer Pet Hatch has been deployed while the game is open: each build publishes
 * version.json (see vite.config.ts), which the game checks when it comes back to the foreground and
 * once an hour while it stays open.
 */

/** How often an open game looks for a newer deploy. */
const CHECK_EVERY_MS = 60 * 60_000;
/** Coming back to the game checks again, but not more often than this. */
const MIN_GAP_MS = 60_000;

export interface Build {
  version: string;
  /** File name of the game's bundle, which changes with every rebuild, even without a version bump. */
  entry: string;
}

/** A different version, or the same version rebuilt, means a newer deploy is out. */
export function isUpdate(current: Build, deployed: unknown): deployed is Build {
  if (!deployed || typeof deployed !== 'object') return false;
  const { version, entry } = deployed as Partial<Build>;
  if (typeof version !== 'string' || !version) return false;
  if (version !== current.version) return true;
  return typeof entry === 'string' && !!entry && !!current.entry && entry !== current.entry;
}

/**
 * The deployed build. The request names the version this game runs, so a server that counts open games
 * (server/php/stats.php) can also tell which versions are in use; it carries nothing else.
 */
async function fetchDeployed(current: Build): Promise<unknown> {
  try {
    const res = await fetch(`./version.json?v=${encodeURIComponent(current.version)}&t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    // Offline, or a server without version.json (it may answer with the game page): try again later.
    return null;
  }
}

/** Calls onUpdate once, the first time a check finds a newer deploy. */
export function watchForUpdates(current: Build, onUpdate: (deployed: Build) => void): void {
  let lastCheck = 0;
  let found = false;
  const check = async () => {
    if (found || document.hidden || Date.now() - lastCheck < MIN_GAP_MS) return;
    lastCheck = Date.now();
    const deployed = await fetchDeployed(current);
    if (!found && isUpdate(current, deployed)) {
      found = true;
      onUpdate(deployed);
    }
  };
  void check();
  setInterval(() => void check(), CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => void check());
  window.addEventListener('pageshow', () => void check());
  window.addEventListener('online', () => void check());
}
