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

To change the app icon, edit `public/icons/icon.svg`, then run `npm run icons`.

## Live battles (optional)

Live battles let two friends fight in real time. They need a tiny relay server that pairs two phones by a room
code and forwards their moves; both phones run the battle themselves, and the relay stores nothing. Without a
relay, the game works exactly the same and the live battle button simply doesn't appear.

The bundled relay also serves the built game, so one process can host everything:

```bash
npm install
npm run build
PORT=8787 npm run relay
```

Put it behind your HTTPS reverse proxy (WebSockets need to be passed through for `/relay`). The game finds the
relay through `/relay.json`, which the relay serves automatically.

If the game is hosted elsewhere (any static web server), run the relay on its own and either build with
`VITE_RELAY_URL=wss://your-relay.example/relay npm run build`, or put a `relay.json` next to `index.html`:

```json
{ "url": "wss://your-relay.example/relay" }
```

In development, run `npm run relay` next to `npm run dev`; the dev server forwards `/relay` to it.

