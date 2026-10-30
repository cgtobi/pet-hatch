# Changelog

## 0.5.0

- Alerts: where the game is hosted with PHP, players can turn on alerts in Settings, and their phone tells them
  when the pet calls, the egg needs care or is ready to hatch, even with the game closed (never at night). On
  iPhone and iPad, add the game to the Home Screen first.
- Not in this app yet: the Home Assistant app's server doesn't send alerts, so the setting doesn't show here.

## 0.4.4

- The debug options (skipping time, a faster clock) are gone from the released game.

## 0.4.3

- Dojo: waiting is shorter. The search for a similar pet widens steadily after 10 seconds, and if nobody close in
  strength turns up, a stronger or weaker pet is offered after 40 seconds (was 90).

## 0.4.2

- Dojo: when no pet of similar strength turns up for a while, you may be offered a stronger or weaker one. The
  fight only starts if both players agree within 20 seconds; turning it down sends both back to waiting.
- Beating a much stronger pet (35% or more) is an upset and gives double the stat points.

## 0.4.1

- Under the hood: the game's code is reorganised and better tested. Nothing changes in play.

## 0.4.0

- Fairer live battles: moves are locked in with a stronger seal, so a modified game can't pick its move after
  seeing yours, and a dojo opponent must fight with the very pet it was matched with.
- Live battles only work between games of this version or later; older games are asked to reload.
- Too many wrong room codes in a row are turned away for a while.

## 0.3.19

- The battle server limits how many connections one visitor can hold (IPv6 counted by network), so nobody can
  take every room or dojo place.

## 0.3.18

- Security fixes: a malformed web address can no longer stop the app, and an opponent can no longer fake a
  disconnect to win a live battle. Home Assistant now restarts the app if it stops answering.
- Imported save codes are checked properly, and a save with an unknown language no longer breaks the game.
- The evening lullaby follows your bedtime setting.

## 0.3.17

- How to play mentions that a game server may count dojo visits per pet, without names. This Home Assistant app
  doesn't count anything.

## 0.3.16

- Training and battle costs now say energy points instead of percent, since endurance can raise the maximum
  above 100.

## 0.3.15

- Endurance training is here for everyone: a jump-rope rhythm game on the Train sheet. Endurance gives your pet
  more energy (up to +50), so it can train, play and battle longer. It doesn't count in battles.

## 0.3.14

- Not every pet lives exactly 37 days any more: each one stays an adult up to 3 days longer and an elder up to
  2 days longer.

## 0.3.13

- Preview, off by default: Endurance training with a jump-rope rhythm game. Endurance gives the pet more
  energy, so it can train, play and battle longer. Open the game with `?endu=1` to try it (`?endu=0` to hide it
  again).

## 0.3.12

- Settings shows only the difficulty you chose for this egg, and Language has moved below Start a new egg.

## 0.3.11

- How forgiving the game is (Cozy, Gentle, Classic) is now chosen when an egg starts and stays until the next
  egg; Settings shows it but can't change it. New players pick it on a welcome screen.

## 0.3.10

- Opening Training or Battle is smooth now: the camera glides back and up while the menu rises, and glides back
  when it closes.

## 0.3.9

- When a newer version is out, the open game says so and offers a reload. It checks when you come back to it
  and once an hour.

## 0.3.8

- Sunrise and sunset follow your bedtime: the sun comes up at wake-up time and goes down when the evening
  starts, in a warm glow.
- A real night sky: twinkling stars, a faint Milky Way, the moon in its actual phase and the odd shooting star.
- The island's light no longer darkens the sky; on after dark it bathes the island in a warm glow, and
  fireflies drift over it from dusk on.

## 0.3.7

- Every stat at 100 earns a star, shown on the pet, on the Train sheet and in the family list.
- A retiring pet with stats at 100 gives the next generation a bigger head start: 5 extra points in each.

## 0.3.6

- Training slows down as a stat climbs: children learn almost as fast as before, but getting a stat to 100
  now takes most of the adult stage.

## 0.3.5

- In debug mode, Settings shows the game's clock under the version.

## 0.3.4

- The light has a purpose now: evenings get dark and the pet dozes off unless the light is on. It switches
  itself off in the evening and on in the morning, and a dark night gives a happy morning.
- During the day the round button is Nap (or Wake up), independent of the light.
- At night, with the light on, feeding, playing or training wakes the pet for an hour: grumpy, and
  costly if it happens more than once a night. Turn the light off to send it back to bed.
- The egg no longer needs the light.
- Smash training is harder, so strength no longer grows faster than guard and wits.
- Settings shows the app version at the bottom, and its scrollbar stays inside the rounded corners.

## 0.3.3

- The home screen icon shows up again on web servers that reserve /icons/ (such as Apache).
- The game can also connect to the new PHP relay for plain web hosting.

## 0.3.2

- The island turns all the way round; light and the pet follow the view.

## 0.3.1

- Leaving a live or dojo battle after the first turn now counts as a loss, and a dropped connection no longer
  gives both players a win.

## 0.3.0

- Every island is different now: varied trees (round, pine, blossom, apple), bushes, rocks and sometimes a
  small pond.
- The old eggshell weathers away over three days after hatching, or tap it to sweep it away.

## 0.2.0

- New: the **Dojo**. Enter it from the Battle tab to be matched with other players' pets of similar strength
  and fight them live; you only take part while you stay in the dojo.
- Dragging now turns the island with your finger.
- Each app update now always builds the latest game instead of a cached copy.

## 0.1.0

- First Home Assistant app: the game, served from the sidebar (ingress) and on port 8787, with live battles.
