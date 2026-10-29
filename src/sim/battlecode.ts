import { speciesName } from './evolution';
import type { Fighter } from './battle';
import { STAT_CAPS, STATS } from './training';
import type { ElementType, FormId } from './types';

/**
 * Battle codes: a short, copy-pasteable snapshot of a pet that a friend can battle on their own device.
 * Layout (bytes): version, type|stage|teen, form, power, speed, guard, wits, discipline, seed (2), name (UTF-8), checksum.
 * Encoded as base64url, so it also fits in a link (?challenge=…).
 */
const VERSION = 1;
const TYPES: ElementType[] = ['ember', 'tide', 'bloom', 'astral'];
const FORMS: FormId[] = [
  'baby',
  'child.bright',
  'child.scruffy',
  'teen.physical',
  'teen.technical',
  'adult.power',
  'adult.speed',
  'adult.guard',
  'adult.wits',
];
const TEENS = [null, 'teen.physical', 'teen.technical'] as const;
const MAX_NAME_BYTES = 56;
export const CHALLENGE_PARAM = 'challenge';

function checksum(bytes: Uint8Array): number {
  // FNV-1a, folded to one byte: enough to catch typos and truncated pastes.
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return (h ^ (h >>> 8) ^ (h >>> 16) ^ (h >>> 24)) & 0xff;
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function encodeFighter(f: Fighter): string {
  const name = new TextEncoder().encode(f.name).slice(0, MAX_NAME_BYTES);
  const body = new Uint8Array(10 + name.length);
  body[0] = VERSION;
  body[1] = (TYPES.indexOf(f.type) << 6) | (f.stage << 3) | TEENS.indexOf(f.teen);
  body[2] = FORMS.indexOf(f.form);
  STATS.forEach((s, i) => (body[3 + i] = Math.round(f.stats[s])));
  body[7] = Math.round(f.discipline);
  body[8] = (f.seed >>> 8) & 0xff;
  body[9] = f.seed & 0xff;
  body.set(name, 10);
  const all = new Uint8Array(body.length + 1);
  all.set(body);
  all[body.length] = checksum(body);
  return toBase64Url(all);
}

/** Accepts a bare code or a whole challenge link; returns null for anything that isn't a valid code. */
export function decodeFighter(input: string): Fighter | null {
  let text = input.trim();
  const param = text.match(new RegExp(`[?&]${CHALLENGE_PARAM}=([A-Za-z0-9_-]+)`));
  if (param) text = param[1];
  const all = fromBase64Url(text);
  if (!all || all.length < 12) return null;
  const body = all.subarray(0, all.length - 1);
  if (checksum(body) !== all[all.length - 1] || body[0] !== VERSION) return null;

  const type = TYPES[body[1] >> 6];
  const stage = (body[1] >> 3) & 7;
  const teen = TEENS[body[1] & 7];
  const form = FORMS[body[2]];
  if (!form || teen === undefined || stage < 1 || stage > 4) return null;
  const expected = stage === 1 ? 'child.' : stage === 2 ? 'teen.' : 'adult.';
  if (!form.startsWith(expected)) return null;
  const stats = Object.fromEntries(STATS.map((s, i) => [s, body[3 + i]])) as Fighter['stats'];
  if (STATS.some((s) => stats[s] > STAT_CAPS[stage]) || body[7] > 100) return null;
  let name: string;
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(10)).trim();
  } catch {
    return null;
  }
  return {
    name: name || speciesName(type, form),
    type,
    form,
    stage,
    stats,
    discipline: body[7],
    teen,
    seed: (body[8] << 8) | body[9],
    wild: false,
  };
}
