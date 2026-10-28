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

- `?debug` adds a Debug section to Settings (skip time, make the egg ready).
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
