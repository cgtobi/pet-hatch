# Pet Hatch

Hatch and raise a tiny creature on a floating island. A real-time, Tamagotchi-style web game built with three.js
that runs on phones and installs as an app. See [DESIGN.md](DESIGN.md) for the game design.

## Develop

```bash
npm install
npm run dev
```

The dev server listens on your network too (`--host`), so you can open it on your phone in the same Wi-Fi.

Handy URL flags (dev server only; the built game ignores them):

- `?debug` adds a Debug section to Settings (skip time, make the egg ready or jump the pet to its next life stage).
- `?speed=600` runs game time 600× faster.

```bash
npm test
```

## Deploy

```bash
npm run build
```

Upload the contents of `dist/` to any static web server, in any folder. Serve it over HTTPS so it can be
installed as an app and played offline.

`npm run deploy` builds the game and puts every way of hosting it in `deploy/` (not tracked), with a
`README.txt`: `static/` (the game alone), `php/` (with the PHP relay) and `node/` (with the Node relay, started
with `npm start`). See the live battle sections below.

To change the app icon, edit `public/app-icons/icon.svg`, then run `npm run icons`.

## Live battles (optional)

Live battles let two friends fight in real time, and the **dojo** matches strangers' pets of similar strength. They need a tiny relay server that pairs two phones by a room
code and forwards their moves; both phones run the battle themselves, and the relay stores nothing. Without a
relay, the game works exactly the same and the live battle button simply doesn't appear.

The bundled relay also serves the built game, so one process can host everything:

```bash
npm install
npm run build
PORT=8787 npm run relay
```

Put it behind your HTTPS reverse proxy (WebSockets need to be passed through for `/relay`). The game finds the
relay through `relay.json`, which the relay serves automatically. It also works under a path prefix.

If the game is hosted elsewhere (any static web server), run the relay on its own and either build with
`VITE_RELAY_URL=wss://your-relay.example/relay npm run build`, or put a `relay.json` next to `index.html`:

```json
{ "url": "wss://your-relay.example/relay" }
```

In development, run `npm run relay` next to `npm run dev`; the dev server forwards `/relay` to it.

### PHP hosting

For ordinary web hosting with PHP but no way to run Node, there is a PHP relay (`server/php/relay.php`)
with the same rooms and dojo. It works over plain HTTP (the game long-polls) instead of WebSockets, needs PHP 8.1
or newer and no database, and keeps its little state in a `relay-data/` folder it creates next to itself.

```bash
npm install
npm run deploy
```

Then upload the contents of `deploy/php/` (the game, `relay.php` and a `relay.json` pointing at it) to your host,
over HTTPS. The web server's PHP user must be able to create `relay-data/`; its state file is unreadable over
the web (Apache also gets an `.htaccess`). To keep it elsewhere, set the `PETHATCH_DATA_DIR` environment variable.

Every waiting player keeps one PHP request open for up to 8 seconds at a time (only one per connection: a new
poll ends the one before), so a host with very few PHP workers fits only a handful of players at once. While
nothing changes, a waiting poll only checks whether the state file changed, instead of reading it.

One visitor (IP address; an IPv6 address counts by its /64 network, which one home or phone gets) can hold at most
16 connections, so nobody can take every room. The Node relay has the same limit. If every player reaches the
relay from the same address (behind a proxy or CDN that doesn't pass the real one on), set `PETHATCH_MAX_PER_IP`
to `0` to turn that limit off, or raise it.

Data files are replaced whole (written to a temporary file, then renamed), so a crash or a full disk never leaves
one empty or half written. `common.php` holds what `relay.php` and `stats.php` share.

`npm run test:php` runs the live battle and dojo tests against it in Docker (Apache with PHP), plus its own tests
of these limits and of the stats below.

#### Stats

`deploy/php/` keeps stats in three tiers, all on one dashboard at `stats.php?view&token=…`. `npm run deploy`
makes the token once, keeps it in `.stats-token` (not tracked) and prints the link; set `PETHATCH_STATS_TOKEN`
on the server to use another.

1. **Open games per day** (everyone, no consent): an `.htaccess` routes the game's update check (`version.json`)
   through `stats.php`, which answers with the same file and counts each browser and network once a day, as a hash
   of IP address and browser with a salt replaced every day. Only today's hashes are kept; after that only daily
   numbers and the versions in use (400 days). One visitor counts for at most 8 games a day, whatever browser it
   claims. Needs Apache with `mod_rewrite`; merge the lines into an existing
   `.htaccess` rather than overwriting it. Without it nothing is counted and nothing breaks.
2. **Pets in the dojo** (everyone who uses it, no consent): `relay.php` counts pets that join the dojo from the
   battle code they send to be matched, keyed by a secret-salted hash of its unchanging parts (type, part of the
   seed, name; the name is never stored), with first and last visit and last stage and form, until 90 days after
   the last visit. Codes are easy to make up, so one visitor adds at most 5 new pets a day, and the count keeps at
   most 20,000.
3. **Pet details** (opt-in): with `stats.json` next to the game, players are asked once (unticked on the welcome
   screen, a one-time question for existing players, a toggle in Settings). An opted-in game sends a snapshot per
   pet at most once a day and when something changes: a number hashed from the egg's seed, phase and stage, type,
   form, mode, generation, stars and how its story ended. No names, no save, no IP address; kept 180 days, at most
   200 snapshots per visitor and 5,000 in all per day. Leave
   out `stats.json` and nobody is asked.

Not legal advice, but your privacy notice should say, roughly: the game counts open games per day from its update
check, using a hash of IP address and browser that is deleted daily; the dojo counts which pets visit it, by a
pseudonymous hash of their battle code without names, kept 90 days after the last visit; players who agree also send anonymous
pet details, which they can switch off in Settings; no cookies. Also say how long your host keeps its access
logs.

The Node relay and the static deploy have none of this.

#### Alerts

`deploy/php/push.php` lets the phone tell players when their pet calls or their egg needs care, while the game is
closed ("Pip is calling!"), by web push. Players turn it on in Settings; on iPhone and iPad only once the game is
on the Home Screen (Safari only offers push there).

- **Cron job:** every minute (`* * * * *`), run `php /path/to/push.php tick`, or open
  `https://…/push.php?tick&token=…` (the stats token) where your host's cron only opens addresses. Every 5 minutes
  works too. Each run prints what it sent, e.g. `sent 2, failed 0, gone 0`.
- **Keys:** `npm run deploy` makes a key pair once and keeps it in `.push-keys` (not tracked; keep it, or every
  phone has to turn alerts on again). The private key goes to `push-key.php`, the public one to `push.json`, which
  tells the game alerts exist. Leave out `push.json` to switch alerts off.
- **How:** the game works out from its own simulation when the next calls will come and, each time it is closed,
  sends those times (the next day's, at most 6 in a row, none at night); opening it clears them. Alerts only go to
  the push services of Chrome, Safari, Firefox and Edge.
- **Stored per phone:** its push address and keys, the alert times with their kind (call, egg, hatch), the site's
  address, a hash of the IP address that signed it up (at most 20 phones each) and when it last checked in.
  Nothing about the pet; the words, with its name, stay on the phone. Forgotten when the player turns alerts off,
  when the push service says the address is gone, or after 30 days without the game being opened.
- **Needs:** PHP 8.1+ with openssl, and curl or `allow_url_fopen`.

For your privacy notice: players who turn on alerts are sent push messages through their browser's push service
(Google, Apple, Mozilla or Microsoft); the server keeps their push address and alert times until they switch
alerts off, or 30 days after they last opened the game.


## Docker

The `Dockerfile` builds the game and runs it together with the relay (Node 22 on Alpine, non-root, port 8787,
with a health check on `/health`). It builds for `amd64` and `arm64`.

```bash
docker build -t pet-hatch .
docker run -d -p 8787:8787 --restart unless-stopped pet-hatch
```

Or with Compose: `docker compose up -d` (see `docker-compose.yml`). Put it behind an HTTPS reverse proxy that
passes WebSockets through; with Caddy that is a single line: `pets.example.com { reverse_proxy localhost:8787 }`.

## Home Assistant app

This repository is also a Home Assistant app repository (`repository.yaml` and the `pet_hatch/` folder). The app
shows the game in the Home Assistant sidebar (ingress, for logged-in users) and on port 8787 for direct access,
e.g. for friends' phones. See `pet_hatch/DOCS.md` for how players use it.

To install it: in Home Assistant, go to Settings › Apps › App store › ⋮ › Repositories, add
`https://github.com/cgtobi/pet-hatch`, then install **Pet Hatch**.

For a fork, change the repository URL in `repository.yaml`, `pet_hatch/config.yaml` and `PET_HATCH_REPO` in
`pet_hatch/Dockerfile` (plus `PET_HATCH_REF` for the branch or tag to build).

Home Assistant builds the app on the device: it clones the repository and builds the game there (a few minutes
on a Raspberry Pi). When releasing, bump `version` in `pet_hatch/config.yaml` together with `package.json` and
add a line to `pet_hatch/CHANGELOG.md`. The app store icon and logo are rendered by `npm run icons`.
