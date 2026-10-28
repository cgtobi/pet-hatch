# Pet Hatch: game design

A Tamagotchi-style pet game for phones. You care for an egg in real time, it hatches into a creature whose
element depends on how you cared for it, and the creature then grows up, trains and battles (Pokémon-inspired).

Status of each part: ✅ built, 🔜 planned.

## Platform

- ✅ Vite + TypeScript + three.js. `npm run build` outputs static files with relative paths, so `dist/` runs from
  any folder on any web server. No backend.
- ✅ Installable web app: manifest, icons, and a service worker that precaches the build for offline play.
  Install needs HTTPS (or `localhost`).
- ✅ Saves live in `localStorage`. Settings › Backup copies/loads a save code to move between devices.
- ✅ English and German (`src/i18n.ts`); defaults to the device language and is switchable in Settings.

## Time

- ✅ **Real time.** The simulation stores the time it last ran to; on load it replays the missed time in
  one-minute steps (capped at 14 days). One jump and many small steps give the same result (tested).
- ✅ **Sleep window** (default 22:00–07:00, set in Settings). Needs drain at 10% with the lights off,
  30% with them left on, and no care mistakes count while you sleep.
- ✅ **Debug:** `?debug` shows Settings › Debug (+1 h, +6 h, Ready now); `?speed=600` runs game time 600×.

## Egg phase

The exact hatch time is **hidden** and **random**:

- When an egg is laid, it secretly rolls a development time of **20–28 h**.
- Good care (healthy, needs above half) speeds development by 10%; unmet needs slow it to 85%.
- The player only sees five coarse stages: **Quiet → Stirring → Wobbly → Cracking → Hatching**.
  Each egg jitters its stage thresholds by ±4%, so a stage never reveals the exact time left.
- Visual tells grow with the stage: occasional wobbles → frequent wobbles → spreading cracks → shaking and glowing.
- **The hatch waits for you.** Once ready, the egg hatches only while you watch: tap it 12 times to break out.
  If nobody comes back within 12 h, it hatches on its own and the reveal plays next time you open the game.

| Action | Gesture on the egg | Dock button | Meter (empties in ~) | Pushes toward |
|---|---|---|---|---|
| Warm | press and hold | hold Warm | Warmth (3 h) | Ember |
| Mist | swipe up | Mist | Humidity (4 h) | Tide |
| Comfort | stroke back and forth, or tap | Sing | Bond (5 h) | Bloom |
| Turn | swipe sideways | Turn | due every 4 h | health only |
| Lights | – | Lights | – | lets it rest at night |

- Only care that actually raises a meter counts toward the element (no spamming at 100%).
- **Element at hatch** = the dominant kind of care. Near-perfect balance (every share ≥ 29%) with good health gives
  the rare **Astral** type.
- **Health** drops while needs are empty and recovers while all needs are above 40%.

### Neglect modes (Settings)

| Mode | Effect |
|---|---|
| Cozy | No health loss. Neglect only shapes the outcome. |
| Gentle (default) | Health loss, floored at 10%. It always hatches, just more slowly. |
| Classic | 1.5× health loss. At 0 the egg is lost and you start a new one. |

## After hatching (🔜 milestones 2–4)

- Life stages: Egg 1 d → Baby 1 d → Child 3 d → Teen 5 d → Adult ~3 wk → Elder ~1 wk. The Elder then retires
  and leaves an egg that inherits one trait or move.
- Needs: Hunger, Mood, Energy, Hygiene (droppings), Health (sickness, medicine) and Discipline.
- Evolution: Child form by care quality, Teen form by physical vs. technical training, Adult form by highest
  stat. About 9 forms per type, all built in code from primitives.
- Training: Power / Speed / Guard / Wits minigames of 15–30 s; each costs ~20% energy; each stage caps stats.
- Battles: 1v1 turn-based, 4 moves, type triangle Tide › Ember › Bloom › Tide (Astral has no weakness).
  Low discipline means the pet may ignore orders. Wild AI battles, plus async battles via share codes.

## Look

Cute low-poly scene: a floating island with toon shading (three-band gradient map), a sky that follows the local
time, drifting clouds and bobbing mini-islands. The egg's speckles take on the colors of the care it gets.
UI: Fredoka (display) + Nunito (body), self-hosted Latin subsets.

## Milestones

1. ✅ Simulation core, island scene, egg phase, hatch and reveal, settings, i18n, installable app.
2. 🔜 Baby care loop and aging stages.
3. 🔜 Training minigames, stats and evolution.
4. 🔜 Moves and battles, wild creatures and share codes.
5. 🔜 Polish: sound design, haptics tuning, more languages.

## Code map

| Path | What |
|---|---|
| `src/sim/` | Pure game rules, no DOM or three.js: `egg.ts` rules, `game.ts` catch-up and hatching, `save.ts` persistence. Unit tested in `sim.test.ts`. |
| `src/scene/` | three.js: `world.ts` (renderer, camera framing, lights), `island.ts`, `egg3d.ts`, `baby.ts`, `sky.ts`, `effects.ts`. |
| `src/input/gestures.ts` | Pointer events → hold / swipe / stroke / tap / orbit. |
| `src/ui/` | DOM HUD, settings sheet and icons. |
| `src/i18n.ts` | All player-facing text, English and German. |
| `src/main.ts` | Wires it together: game loop, actions, hints, hatch moment. |
| `vite.config.ts` | Relative base and the service-worker generator. |
