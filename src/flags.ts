/**
 * Features still being tried out, switched on per device with a URL parameter: ?endu=1 turns endurance training
 * on and remembers it (so an installed app keeps it), ?endu=0 turns it off again.
 */

const KEY = 'pethatch.flags';

function stored(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function flag(param: string): boolean {
  const all = stored();
  const value = new URLSearchParams(location.search).get(param);
  if (value === '1' || value === '0') {
    all[param] = value === '1';
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      // Storage blocked: the flag still applies to this visit.
    }
  }
  return all[param] === true;
}

export const FLAGS = {
  /** The Endurance stat and its jump-rope training. */
  endurance: flag('endu'),
};
