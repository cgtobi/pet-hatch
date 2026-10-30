/**
 * What the parts of the running game share (care, battles, story moments): set up once in main.ts and handed to
 * each, so none of them reaches into another's variables.
 */
import type { Vector3 } from 'three';
import type { World } from '../scene/world';
import type { GameState, PetState } from '../sim/types';
import type { Hud } from '../ui/hud';
import type { ActivitySheet } from '../ui/sheet';

export interface Game {
  readonly state: GameState;
  readonly world: World;
  readonly hud: Hud;
  readonly sheet: ActivitySheet;
  /** Current game time. */
  now(): number;
  /** The pet while it's hatched and alive (null for an egg, or after its story ended). */
  livePet(): PetState | null;
  /** An egg that is still being cared for (not hatched, not lost). */
  eggActive(): boolean;
  save(): void;
  /** Redraw the status card, hint and dock. */
  refresh(): void;
  /** Where effects on the pet appear (the egg, before there is one). */
  petCenter(): Vector3;
}
