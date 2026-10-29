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

## Life after hatching

### Life stages ✅

Egg 1 d → **Baby** 1 d → **Child** 3 d → **Teen** 5 d → **Adult** 3 wk → **Elder** 1 wk. The pet grows bigger at
each stage, with a spin, flash and sparkle when it does. After the Elder stage it retires: it sets off on an
adventure and leaves a new egg. (🔜 The new egg inherits one trait or move from its parent.)

You name the baby when it hatches (a name is suggested).

### Needs and care ✅

| Need | Drops by (per awake hour, Baby → Adult) | Care action |
|---|---|---|
| Food | 25 → 12 | **Feed** (+35; refused when nearly full or asleep) |
| Mood | 18 → 10 (×1.5 while sick) | **Play** (+20 mood, −12 energy) or tap the pet (+2) |
| Energy | −5 awake; +25 asleep in the dark, +10 with lights on | Sleep, **Lights** off at night |
| Clean | One dropping 1.5–3 h after each meal (max 5) | **Clean** |

- **Naps:** a pet that runs out of energy during the day naps on its own until it has 70% again.
  Energy never triggers a call, because the player can't fix it directly.
- **Sickness:** droppings piling up, starving and misery make sickness likely (per-hour chance); **Medicine** cures it in
  two doses. Medicine when not sick upsets it. Cozy mode has no sickness.
- **Health** recovers while fed and happy, and drops while sick.
- **Attention calls (the "!" bubble):** the pet calls when food or mood drops below 20% or it gets sick
  (a *need* call, cleared by caring for it). Every 3–6 awake hours it also throws a *tantrum*, a call with nothing
  wrong. **Scold** fixes a tantrum (+20 discipline). Scolding a pet with a real need, or for nothing, upsets it.
  The hint line helps tell the two apart: "…but nothing seems wrong".
- **Care mistakes** (stored per life stage, for evolution in milestone 3): an ignored call (30 min), a dropping
  left 1 awake hour, lights left on 30 min into bedtime (once per night). A diligent owner makes almost none (tested).
- **Night:** calls pause, droppings don't age, and needs drain at 10% (lights off) or 30% (lights on).

### Endings ✅

| Mode | Neglect leads to |
|---|---|
| Cozy | Nothing bad: no sickness, health never below 50%. |
| Gentle (default) | Health floor 10%; after 24 awake hours of total neglect (starving *and* miserable) the pet **runs away**. |
| Classic | 1.5× health loss; at 0 the pet **dies**. |

After any ending, a new egg starts.

### Training and stats ✅

Four stats, each trained by its own 15–30 s minigame from the **Train** sheet (opens from the dock):

| Stat | Minigame | How it plays |
|---|---|---|
| Power | Smash | Mash to fill a meter before time runs out; 3 rounds, faster drain each round. |
| Speed | Star catch | Tap stars before they fade; 20 s, they come faster and fade sooner. |
| Guard | Block | Tap the side an attack comes from just before it lands; 12 attacks. Swinging at nothing leaves that side open briefly, so mashing fails. |
| Wits | Recall | Repeat a growing sequence of four pads (3 → 8 long); one mistake ends it. |

- A session costs 20% energy and a little food; a score of 0–100% earns 1–6 points. Each type learns one stat
  25% faster (Ember Power, Tide Speed, Bloom Guard, Astral Wits); scruffy children learn 20% slower, elders 50%.
- **Caps per life stage:** babies can't train; Child 30, Teen 60, Adult and Elder 100.
- Training needs the pet awake, healthy, with ≥ 20% energy and not starving.
- **Disobedience:** below 40 discipline the pet may refuse (up to 30% at 0) and throw a tantrum instead, which
  scolding fixes. The roll is fixed per minute, so retrying straight away doesn't help.

### Evolution ✅

Nine forms per type, 36 in all, built in code from primitives (body proportions, ears, tail, arms, wings, horn,
shell, orbs, plus the type's color, crest and accent). Each has its own species name (`src/sim/evolution.ts`).

| Becomes | Form decided by |
|---|---|
| Child | Baby care: ≤ 2 care mistakes as a baby → *bright*, more → *scruffy* |
| Teen | Training so far: Power + Speed ≥ Guard + Wits → *physical*, else *technical* |
| Adult | Best stat → *power* / *speed* / *guard* / *wits* form (ties go to the type's favorite) |
| Elder | Keeps its adult form, slightly faded |

Evolution happens in the simulation, so it also happens while you're away; the animation and an explanation
("…its strongest side, Power, shaped its adult form") play the next time you look.

### Help ✅

Settings › How to play explains the mechanics in ten short, collapsible topics (egg, types, care, calls and
discipline, care mistakes, growing up, training, evolution, battles, neglect modes). It never reveals the hidden hatch time.

### Battles ✅

Train › **Battle** tab (from the child stage on). Battles happen on the island: the opponent pops in, both creatures
line up, and a bottom sheet shows HP bars, a log line and the move buttons. 1v1, turn-based, one move per turn.

- **Stats in battle:** HP = 60 + 15 per life stage (up to adult) + Guard. Power raises damage, Guard lowers damage
  taken, Speed decides who acts first (and gives a small dodge chance), Wits raises the critical-hit chance.
- **Type triangle:** Tide › Ember › Bloom › Tide: ×1.5 when strong, ×0.67 when weak. Only element moves use it.
  Astral has no strength and no weakness.
- **Moves** grow with the pet: a child knows 2, a teen 3, an adult 4. The teen form decides the third move, the
  adult form the fourth.

| Move | Learned | Effect |
|---|---|---|
| Tackle | always | Power 35 |
| Element move (Ember Spit / Splash Jet / Vine Whip / Star Ray) | always | Power 45, element |
| Rush | sporty teen | Power 60, 85% accuracy |
| Focus | clever teen | Heals 20%; next hit ×1.5 |
| Power Slam | Power adult | Power 80, element, 80% accuracy |
| Flurry | Speed adult | 3 × 18, always strikes first |
| Shell Up | Guard adult | Heals 15%; raises Guard (twice at most) |
| Mind Trick | Wits adult | Power 40, element; 50% chance the foe loses its next turn |

- **Disobedience:** below 50 discipline a pet may ignore an order (up to 40% at 0): it either loafs or uses a move of
  its own choosing. This applies to a friend's pet too, so their discipline matters when you battle their code.
- **Opponent AI:** heals when low, sometimes sets up a daze or focus, otherwise picks the hardest-hitting move (with
  some randomness).
- **Wild creatures** match your pet's life stage and are about as strong as it (75–115% of its stat total, with a
  floor so untrained pets still meet real foes). Any type, Astral rarely. Simulated: a pet of average stats wins
  about 50–65% of wild battles in 3–6 turns.
- **Cost and reward:** a battle uses 25% energy and a little food (it needs ≥ 25% energy, awake, healthy, fed).
  A win gives +10 mood and +2 to a random stat below the cap; a loss costs 8 mood. Running away costs 3 mood.
  Wins and losses are recorded.

### Friend battles (share codes) ✅

- **Battle code:** a ~20-character snapshot of your pet (name, type, form, life stage, stats, discipline, teen
  path) with a checksum, encoded as base64url (`src/sim/battlecode.ts`). Codes are validated: typos, cut-off pastes
  and impossible pets (stats over the stage cap, form not matching the stage) are rejected.
- **Share** sends a challenge link (`…/?challenge=CODE`) through the phone's share sheet, or copies it. Opening the
  link opens the Battle tab with the code filled in. Pasting either the code or the whole link works.
- The friend's pet is played by the computer on your device; nothing is sent anywhere, and your own pet is never
  changed by someone else's battle. After a friend battle you can share the result.

### Still to come

- The new egg inherits one trait or move from its parent.

## Look

Cute low-poly scene: a floating island with toon shading (three-band gradient map), a sky that follows the local
time, drifting clouds and bobbing mini-islands. The egg's speckles take on the colors of the care it gets.
UI: Fredoka (display) + Nunito (body), self-hosted Latin subsets.

## Milestones

1. ✅ Simulation core, island scene, egg phase, hatch and reveal, settings, i18n, installable app.
2. ✅ Pet care loop, attention calls and discipline, sickness, naps, aging stages, endings, naming.
3. ✅ Training minigames, stats with stage caps, evolution forms, help section.
4. ✅ Moves and battles, wild creatures, share codes and challenge links.
5. 🔜 Polish: sound design, haptics tuning, more languages.

## Code map

| Path | What |
|---|---|
| `src/sim/` | Pure game rules, no DOM or three.js: `egg.ts` and `pet.ts` rules, `training.ts` stats and caps, `evolution.ts` forms and species names, `battle.ts` battle rules, moves and wild creatures, `battlecode.ts` share codes, `game.ts` catch-up and hatching, `save.ts` persistence and save upgrades. Unit tested in `sim.test.ts`, `pet.test.ts`, `training.test.ts` and `battle.test.ts`. |
| `src/scene/` | three.js: `world.ts` (renderer, camera framing, lights), `island.ts`, `egg3d.ts`, `pet3d.ts` (the living pet and its 9 body plans), `sky.ts`, `effects.ts`. |
| `src/input/gestures.ts` | Pointer events → hold / swipe / stroke / tap / orbit. |
| `src/ui/` | DOM HUD, settings sheet (with help), the Training/Battle sheet (`sheet.ts`, `training.ts`, `arena.ts`), the four minigames and icons. |
| `src/i18n.ts` | All player-facing text, English and German. |
| `src/main.ts` | Wires it together: game loop, care actions, hints, hatch moment, growing up and endings. |
| `vite.config.ts` | Relative base and the service-worker generator. |
