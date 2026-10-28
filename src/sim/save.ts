import { DEFAULT_SETTINGS } from './game';
import type { GameState } from './types';

const KEY = 'pethatch.save';

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSave(raw) : null;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked (private mode): the game keeps running, it just won't persist.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** A copy-pasteable backup code. */
export function exportSave(state: GameState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function importSave(code: string): GameState {
  const bin = atob(code.trim());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const state = parseSave(new TextDecoder().decode(bytes));
  if (!state) throw new Error('That save code is not valid.');
  return state;
}

function parseSave(json: string): GameState | null {
  const s = JSON.parse(json) as GameState;
  const ok =
    s &&
    s.version === 1 &&
    (s.phase === 'egg' || s.phase === 'hatched') &&
    typeof s.simTime === 'number' &&
    typeof s.egg?.baseHours === 'number' &&
    typeof s.settings?.neglect === 'string';
  if (!ok) return null;
  // Fill in settings added after the save was written.
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
  return s;
}
