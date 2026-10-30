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
- ✅ Six languages: English, German, French, Spanish, Italian, Dutch (`src/i18n/`, one file each). The game
  follows the device language and can be switched in Settings. A test checks every translation has every key,
  the same placeholders and help lines, and dock labels short enough for the six-button bar.

## Time

- ✅ **Real time.** The simulation stores the time it last ran to; on load it replays the missed time in
  one-minute steps (capped at 14 days). One jump and many small steps give the same result (tested).
- ✅ **Sleep window** (default 22:00–07:00, set in Settings). Needs drain at 10% with the light off,
  30% with it left on, and no care mistakes count while you sleep. The **evening** is the 4 hours before it
  (`dayPart()` in `src/sim/clock.ts`).
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

The egg simply rests at night; the light only matters once the pet has hatched.

- **Element at hatch** comes from care points per element:
  - Care that raises a meter counts **weighted by how fast that need drains** (warmth drains 34/h, humidity 25/h,
    bond 20/h). Plain keep-alive care is therefore neutral: about a third each. (Before this rule, warmth's faster
    drain made every caring player's egg Ember, about 43/31/26%.)
  - **Pampering**, care given while that meter is already full (holding Warm, extra mists, songs, strokes), counts
    1.5× and is how the player shows a preference. Each need can absorb up to 30 pampering points, refilling at
    30 per hour, so spamming doesn't run away. Pampering shows hearts and "It loves the extra care".
  - An element with more than 38% of the points wins. Below that the egg is **balanced**: it becomes the rare
    **Astral** type if all three were pampered (≥ 40 points each), health is ≥ 80% and there were at most 2 care
    mistakes; otherwise the egg's own seed picks Ember, Tide or Bloom with equal odds.
  - Simulated: diligent or casual care → balanced (random element); two extra mists per visit → Tide (~59%);
    two extra songs → Bloom (~60%); pampering all three evenly → Astral. Eggs from older saves are converted.
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
adventure and leaves a new egg (see *Family*).

You name the baby when it hatches (a name is suggested).

### Needs and care ✅

| Need | Drops by (per awake hour, Baby → Adult) | Care action |
|---|---|---|
| Food | 25 → 12 | **Feed** (+35; refused when nearly full or asleep) |
| Mood | 18 → 10 (×1.5 while sick) | **Play** (+20 mood, −12 energy) or tap the pet (+2) |
| Energy | −5 awake; +25 asleep in the dark, +10 with the light on or dozing | Sleep, **Nap** by day |
| Clean | One dropping 1.5–3 h after each meal (max 5) | **Clean** |

- **Naps:** a pet that runs out of energy during the day naps on its own until it has 70% again.
  Energy never triggers a call, because the player can't fix it directly.
- **The round button beside More** changes with the time of day: **Nap** (then **Wake up**) by day, **Light** in
  the evening and at night. The light means nothing during the day.
- **Power naps:** below 40% energy, **Nap** puts the pet down for a nap. The button glows when the pet could nap
  and is dimmed when it wouldn't (not tired, hungry or sick: it stays up, no penalty).
  - It regains 25 energy per hour while food and mood drain at half speed (no shortcut around care); calls pause.
  - It wakes on its own at 90% ("woke up refreshed", +5 mood), or early when hunger drops below 20% or it gets
    sick (it then calls). Training, battles, feeding and play wait while it sleeps.
  - **Wake up** within 20 minutes makes it grumpy (−5 mood).
- **Evening** (from 4 h before bedtime): it gets dark (the light switches off by itself) and the pet **dozes**:
  light rest (+10 energy per hour, needs at half speed), and feeding, play, training and battles wait.
  - Switching the **Light** on wakes it gently (no grumpiness) and keeps it up until bedtime; off again, it dozes.
  - A hungry (below 20%) or sick pet can't doze: it stays awake and calls.
  - Not around in the evening? Nothing bad happens; it simply dozes until bedtime.
- **Bedtime:** the pet sleeps either way. Light off: full rest; after at least 4 hours in the dark it wakes happy
  (+8 mood, "slept well in the dark"). Light left on: worse sleep (+10 energy per hour, needs at 30%), but no
  care mistake. Morning switches the light back on.
- **Waking it at night:** with the light on, **Feed**, **Play** or **Train** wakes the pet (light plus action is
  deliberate enough, so there is no question first); with it off they let it sleep. How to wake it is explained
  once (a hint with the light on, a tip with it off), then never again.
  - It is grumpy: −10 mood, −15 the second time that night, −20 after that; from the second time on each wake-up
    is a care mistake (not in Cozy). While up it refuses training more often (+25%).
  - It stays up for an hour (needs and energy as by day, calls on), then falls asleep again; light off sends it
    back to bed at once. A woken night loses the good morning, and the lost rest shows in the next day's energy.
- **Sickness:** droppings piling up, starving and misery make sickness likely (per-hour chance); **Medicine** cures it in
  two doses. Medicine when not sick upsets it. Cozy mode has no sickness.
- **Health** recovers while fed and happy, and drops while sick.
- **Attention calls (the "!" bubble):** the pet calls when food or mood drops below 20% or it gets sick
  (a *need* call, cleared by caring for it). Every 3–6 awake hours it also throws a *tantrum*, a call with nothing
  wrong. **Scold** fixes a tantrum (+20 discipline). Scolding a pet with a real need, or for nothing, upsets it.
  The hint line helps tell the two apart: "…but nothing seems wrong".
- **Care mistakes** (stored per life stage, for evolution in milestone 3): an ignored call (30 min), a dropping
  left 1 awake hour, waking the pet a second time in one night. A diligent owner makes almost none (tested).
- **Night:** calls pause, droppings don't age, and needs drain at 10% (light off) or 30% (light on).

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
| Power | Smash | Mash to fill a meter before time runs out; 3 rounds, faster drain each round; only fast tapping fills the last one. |
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

Settings › How to play (one collapsed entry) explains the mechanics in ten short topics (egg, types, care, calls and
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
- **Battle experience:** every real fight fills a bar (10 points = +1 stat), shown in the Battle tab and on the
  result screen. A win earns 4 and a loss 2, scaled quietly by effort (0.5–1.5×): a loser earns more the closer
  the opponent came to fainting, a winner more for beating a stronger opponent (by stat total).
  - **Lessons:** a counted loss remembers the stat where the opponent was furthest ahead (or its best stat if it
    wasn't ahead anywhere). A full bar trains the stat taught most often, crediting the latest teacher
    ("Speed +1, learned from Mochi"); with no lessons waiting, a random stat below the cap.
  - **Guards against farming:** running away and giving up earn nothing; a loss only counts after 3 turns or
    25% damage dealt; a win by forfeit only after 2 turns. Energy limits fights to about 4 a day. If every stat is
    at the stage cap, the bar stays full until the next life stage.

### Friend battles (share codes) ✅

- **Battle code:** a ~20-character snapshot of your pet (name, type, form, life stage, stats, discipline, teen
  path) with a checksum, encoded as base64url (`src/sim/battlecode.ts`). Codes are validated: typos, cut-off pastes
  and impossible pets (stats over the stage cap, form not matching the stage) are rejected.
- **Share** sends a challenge link (`…/?challenge=CODE`) through the phone's share sheet, or copies it. Opening the
  link opens the Battle tab with the code filled in. Pasting either the code or the whole link works.
- The friend's pet is played by the computer on your device; nothing is sent anywhere, and your own pet is never
  changed by someone else's battle. After a friend battle you can share the result.

### Dojo ✅ (needs the relay)

A public waiting room for live battles against strangers of similar strength.

- **Flow:** Battle tab › "Enter the dojo" (same requirements as any battle). The dojo shows how many other pets
  are waiting. When a match is found, both players go straight into a live battle; afterwards "Fight again" goes
  back to waiting and "Done" leaves.
- **Only while there:** you take part only while the dojo screen is open and the app is in the foreground.
  Leaving the screen, closing the sheet, switching apps or locking the phone leaves the dojo at once.
- **Strength:** battle rating = all four stats + 20 per life stage (up to adult). Opponents must be within
  ±10% of your rating at first (at least ±8 points), widening by 5% every 10 s of waiting up to ±35%, so most
  matches are close and some are slightly stronger or weaker. Closest ratings are paired first.
- **Fairness:** the relay computes each rating from the pet's battle code itself (a copy of the game's reader,
  kept in step by a test), so a player can't claim to be weaker than the pet they fight with. The same two pets
  aren't paired again for 2 minutes.
- **Anonymous:** dojo opponents are shown by species and type only, never by the name their owner typed.
- **Relay side** (`server/dojo.mjs`, `/dojo` WebSocket): a queue of waiting players, a matching pass every
  second, and a room reserved for each pair so both can arrive in any order; it closes if they don't both arrive
  within 30 s (the game then simply goes back to waiting). Up to 500 waiting players; nothing is stored.

### Family ✅

- A pet that **retires** (the happy ending) leaves an egg that inherits a head start: about a tenth of the
  parent's best stat (3–8 points) in that stat. The egg is called "Pip's egg", and the new pet carries a
  **generation** chip (Gen 2, Gen 3, …). The reveal tells you what it inherited.
- A pet that ran away or died, or a manual restart, passes nothing on; the next egg is a fresh first generation.
- Settings › **Family** lists every past pet, newest first: generation, name, species, how its story ended, how
  long it lived and its battle wins.

## Sound and touch

- All sound is synthesized with WebAudio (`src/feedback.ts`); there are no audio files. Effects and music run
  through a compressor and a soft generated reverb.
- **Music** is generative: a music-box melody wandering over a pentatonic scale with pad chords. Daytime is
  C major at 84 bpm; evenings and bedtime switch to a slower, lower lullaby; battles get a faster minor tune with
  a bass pulse; it falls silent when the light is off for the night. Audio pauses while the app is hidden.
- **Haptics** use named patterns (tick, tap, press, hit, crit, success, celebrate, hatch…) instead of raw
  durations. iPhones can't vibrate from the web, so the setting only appears where vibration works.
- Settings: **Sound effects**, **Music** and **Vibration** are separate switches.

### Live battles ✅ (optional relay)

- **What:** two friends fight in real time, each choosing their own moves on their own phone. Only shown when the
  deployment has a relay (see README); everything else works without one.
- **Relay** (`server/relay.mjs`, Node + `ws`): pairs two players by a 5-character room code (no 0/O/1/I) and
  forwards messages. It knows nothing about battles and stores nothing. Limits: 2 players per room, 4 KB per
  message, 60 messages per 10 s, rooms close after 15 minutes of silence, dead connections are pinged out. It also
  serves `dist/` and `/relay.json`, so one process can host the whole game.
- **PHP relay** (`server/php/relay.php`): the same rooms, limits and dojo for plain PHP web hosting, over HTTP
  instead of WebSockets. Clients post messages and long-poll for theirs (up to 8 s per request, checked every
  250 ms); a connection that stops polling for 25 s counts as closed. Timers become checks on every request, and
  the shared state is one JSON file behind a lock. `src/net/channel.ts` gives the game one interface for both:
  an http(s) relay URL (or `"transport": "http"` in `relay.json`) means the PHP relay.
  Because every request reads that file, it guards its size: at most 32 KB of unread messages per connection
  (a player who stops reading is closed), 16 open connections per visitor (a salted hash of the IP address, so no
  addresses are kept), 300 rooms and 100 dojo places, and dojo matching at most once a second. Saved JSON escapes
  `<` and `>`, so no message can put a PHP tag into the state file, and PHP notices never reach a reply.
- **Lockstep:** the battle is deterministic, so both phones run it themselves and only exchange pet snapshots
  (battle codes), half a random seed each, and one move per turn (`src/net/live.ts`). The host is battle side a,
  the guest side b, on both phones.
- **Fairness without a referee:** the seed halves and each move are committed as a salted hash first and revealed
  only after the other side committed, so nobody can pick after seeing the other's choice or steer the dice. After
  every turn both phones compare a fingerprint of the battle state; a mismatch calls the battle off. A revealed
  move must match its commitment and be one the pet actually knows.
- **Leaving:** giving up, closing the app or not answering for 3 minutes hands the win to the other player.
  Once the first turn is played, leaving also counts as a **loss** for the leaver (recorded before the page closes),
  and so does losing your own connection; a phone can tell the two apart, so only the player who stayed gets
  the win. Leaving earns no experience.
- **Flow:** Battle tab › "Start a live battle" shows the room code and an invite link (`?live=CODE`); the friend
  opens the link or types the code into the same field used for battle codes. Each phone applies its own result
  (energy, mood, record, reward) to its own pet.
- **Cheating:** a modified app could still lie about its own pet's stats, as with battle codes. Fine between
  friends; preventing it would need the whole game to run on a server.

## Look

Cute low-poly scene: a floating island with toon shading (three-band gradient map), a sky that follows the local
time, drifting clouds and bobbing mini-islands.

- **Every island is different**, laid out from the egg's seed: 1–3 trees (round, pine, blossom or apple),
  2–5 bushes (some with berries or flowers), 1–4 rocks, flowers and grass, and on about 40% of islands a small
  pond with a stone rim, a lily pad and sometimes reeds. Trees and the pond stay at the back and sides so they
  never hide the pet; the nest, the shell spot and both battle spots stay free. The pet walks around this
  island's trees, bushes, larger rocks and pond, and droppings are nudged out of them.
- **The old eggshell** weathers away over three days after hatching: it turns mossy, cracks (a few bits lie
  around it), shrinks, sinks into the grass and fades out. Tapping it sweeps it away at once (it bursts into
  shards; saved). Once it's gone, the pet may walk on that spot. The egg's speckles take on the colors of the care it gets.
UI: Fredoka (display) + Nunito (body), self-hosted Latin subsets.

## Milestones

1. ✅ Simulation core, island scene, egg phase, hatch and reveal, settings, i18n, installable app.
2. ✅ Pet care loop, attention calls and discipline, sickness, naps, aging stages, endings, naming.
3. ✅ Training minigames, stats with stage caps, evolution forms, help section.
4. ✅ Moves and battles, wild creatures, share codes and challenge links.
5. ✅ Polish: synthesized sound and generative music, haptic patterns, four more languages, family and inheritance.

## Code map

| Path | What |
|---|---|
| `src/sim/` | Pure game rules, no DOM or three.js: `egg.ts` and `pet.ts` rules, `training.ts` stats and caps, `evolution.ts` forms and species names, `battle.ts` battle rules, moves and wild creatures, `battlecode.ts` share codes, `game.ts` catch-up and hatching, `save.ts` persistence and save upgrades. Unit tested in `sim.test.ts`, `pet.test.ts`, `training.test.ts`, `battle.test.ts` and `family.test.ts`. |
| `src/scene/` | three.js: `world.ts` (renderer, camera framing, lights), `island.ts`, `egg3d.ts`, `pet3d.ts` (the living pet and its 9 body plans), `sky.ts`, `effects.ts`. |
| `src/input/gestures.ts` | Pointer events → hold / swipe / stroke / tap / orbit. |
| `src/ui/` | DOM HUD, settings sheet (with help), the Training/Battle sheet (`sheet.ts`, `training.ts`, `arena.ts`), the four minigames and icons. |
| `src/i18n/` | All player-facing text: `en.ts` is the source, one file per translation, checked by `i18n.test.ts`. |
| `src/net/` | Live battles: `live.ts` (lockstep protocol over the relay), `dojo.ts` (waiting in the dojo), `channel.ts` (WebSocket or HTTP polling), `relayConfig.ts` (finding the relay). Tested end to end against a real relay in `live.test.ts` and `dojo.test.ts`, and against the PHP relay with `npm run test:php`. |
| `server/relay.mjs` | The optional live battle relay (rooms and the dojo), which can also serve the built game. |
| `server/dojo.mjs` | Dojo matchmaking: ratings from battle codes, the widening match window, pairing. |
| `server/php/` | The relay for PHP web hosting (`relay.php`, `relay.json`); `npm run deploy` bundles it with the game in `deploy/php/`. |
| `scripts/deploy.mjs` | `npm run deploy`: the built game in `deploy/` (untracked), as static, PHP and Node hosting folders. |
| `Dockerfile`, `docker-compose.yml` | One image with the game and the relay (amd64 and arm64). |
| `repository.yaml`, `pet_hatch/` | Home Assistant app: sidebar via ingress plus a direct port; builds from this repository's Git URL. |
| `src/feedback.ts` | Synthesized sound effects, generative music and haptic patterns. |
| `src/main.ts` | Wires it together: game loop, care actions, hints, hatch moment, growing up and endings. |
| `vite.config.ts` | Relative base and the service-worker generator. |
