# Pet Hatch

Hatch and raise a tiny creature on a floating island. A real-time, Tamagotchi-style game for phones: care for
an egg, raise the pet that hatches, train it in minigames and battle wild creatures or your friends' pets.

This app hosts the whole game, including the server for **live battles** between two phones. It stores
nothing: every player's progress lives in their own browser.

## Playing

- **From Home Assistant:** open **Pet Hatch** in the sidebar. This works for anyone logged in to Home
  Assistant, also through the Home Assistant app on your phone.
- **Directly:** open `http://<your-home-assistant>:8787` in the phone's browser. Use this for friends who don't
  have a Home Assistant login.

Live battles work both ways: start one in the Battle tab and send your friend the room code or invite link.
Both of you need to reach the same address (on your home network, or from outside as below).

## Installing it as an app on phones and playing from outside

Phones only install the game (and keep it for offline play) when it's served over **HTTPS**. Plain
`http://…:8787` works for playing, just not for installing.

To play from outside your home network, or to get HTTPS, put port 8787 behind a reverse proxy with a
certificate, for example the **NGINX Home Assistant SSL proxy** or **Cloudflared** app, or your router's own
setup. The proxy must pass WebSockets through for the `/relay` path (most do by default).

## Configuration

There is nothing to configure. To stop friends from reaching the game directly, remove the port mapping in
the app's **Network** settings; the sidebar keeps working.

## Data

The app keeps no data. Saves stay in each player's browser (Settings › Backup in the game copies a save
code). Restarting the app only interrupts live battles in progress.
