# Pet Hatch

Hatch and raise a tiny creature on a floating island. A real-time, Tamagotchi-style web game built with three.js
that runs on phones and installs as an app. See [DESIGN.md](DESIGN.md) for the game design.

## Develop

```bash
npm install
npm run dev
```

The dev server listens on your network too (`--host`), so you can open it on your phone in the same Wi-Fi.

Handy URL flags:

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

Every waiting player keeps one PHP request open for up to 8 seconds at a time, so a host with very few PHP
workers fits only a handful of players at once.

One visitor (IP address) can hold at most 16 connections, so nobody can take every room. If every player reaches
PHP from the same address (behind a proxy or CDN that doesn't pass the real one on), set `PETHATCH_MAX_PER_IP` to
`0` to turn that limit off, or raise it.

`npm run test:php` runs the live battle and dojo tests against it in Docker (Apache with PHP), plus its own tests
of these limits and of the player count below.

#### Player count

`deploy/php/` also carries `stats.php` and an `.htaccess` that routes the game's update check (`version.json`)
through it. It answers with the same file and counts open games per day: each browser and network once a day, as
a hash of the IP address and browser with a salt that is replaced every day. Only today's hashes are kept, to
count each game once; after that only the daily number and the versions in use stay (for 400 days). No cookies,
no IDs, nothing read from or stored on players' devices, so no consent banner is needed; mention it in your
privacy notice.

The dashboard (games open today and per day, 7- and 30-day averages, versions in use) is at
`stats.php?view&token=…`. `npm run deploy` makes the token once, keeps it in `.stats-token` (not tracked) and
prints the link; set `PETHATCH_STATS_TOKEN` on the server to use another. It needs Apache with `mod_rewrite`
and `.htaccess` files allowed; elsewhere `version.json` is served as a plain file and nothing is counted. If your
folder already has an `.htaccess`, add these lines to it instead of overwriting it. Leave out the `.htaccess` to
count nothing.


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
