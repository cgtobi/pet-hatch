# Changelog

## 0.16.0

- Invite a friend, from the menu: send the game's link, or show a QR code for a friend's phone right next to
  yours. Once your pet is a child, the link is also a challenge to battle it.
- A friend who arrives through your link sees who invited them, and your challenge waits for them until their
  own pet is big enough to battle.
- Shared links show as a card with a picture of the island in chat apps. The app fills in its own address, so
  there is nothing to set up.
- The stats dashboard (PHP hosting) shows how often players come back, from the anonymous pet stats players
  opted into. Nothing new is collected.

## 0.15.2

- A small gold dot on the menu button says the species book has something new; it goes away once you open the
  book.

## 0.15.1

- The "…" button is now a menu with Family, the species book and Settings. Family and the book have their own
  pages instead of being tucked away in Settings, and the menu shows when the book has something new.

## 0.15.0

- Play is now a game of fetch: swipe up to throw the ball, and your pet runs after it and brings it back in its
  mouth. Each ball it returns lifts its mood a little more. Throw too far and the ball drops off the island, but
  a new one appears. A pet woken at night still just gets a quick cuddle.

## 0.14.0

- New species book in Settings: all 36 species, filled in as your pets grow into them or meet them in battle.
  Species you haven't found yet show as silhouettes, and new finds are marked until you open the book.

## 0.13.0

- The dojo is never empty any more: if nobody turns up within 20 seconds, the ghost of another player's pet steps
  in. It's a real pet, shown without its name and played by the computer, and a ghost battle gives half the usual
  reward.
- Your own pet leaves a ghost behind when it visits the dojo. When you come back, you hear how it did: "While you
  were away, Pip's ghost fought 3 battles in the dojo and won 2."
- Both the Node relay (this app) and the PHP relay support ghosts. Live battles and the dojo still work with older
  games, which just don't meet ghosts.

## 0.12.1

- Settings always shows the Family section; before your first past pet it says they will appear there.

## 0.12.0

- Training grows with your pet: Smash, Star catch, Block and Recall get harder the stronger your pet is, and
  speed up during each session.
- New twists as your pet grows up: a golden round and power surges in Smash; golden stars and dark stars to
  leave alone in Star catch. Each game's intro explains what's new.
- Recall starts with longer patterns for strong pets and now has a countdown for your whole answer.
- The games take your pet's element colours: sparks, bubbles, petals or stars.
- The result screen shows your best score in each game, and "New record!" when you beat it.

## 0.11.1

- Your very first egg shows you around: the hint walks you through warming, misting, singing and extra care,
  one step at a time, and then tells you when to come back to turn it.

## 0.11.0

- Knock back: once the egg starts wobbling, it sometimes knocks from inside while the game is open. Tap the same
  rhythm back on the egg and it's delighted, and it hatches a little sooner. Missing a knock costs nothing.
- A well-disciplined pet throws far fewer tantrums: from every 3–6 hours with no discipline down to about one a
  day at full discipline.

## 0.10.0

- Eggs hatch much sooner: after 6 to 8 hours of your day instead of a whole day. The egg rests at night and
  waits while you're at school, so all of that time is yours to care for it. Eggs already in progress keep
  how far along they are.
- The speckles on the egg now show what it might become: orange for Ember, blue for Tide, green for Bloom.
  Even care keeps them mixed; the colour you pamper most takes over as it gets close to a sure thing, and
  shiny violet speckles appear when all three are pampered evenly on the way to the rare Astral.
- Before the very first egg, the welcome now asks for your bedtime and school time.

## 0.9.2

- Jump rope is more forgiving: a jump clears the rope if your pet is in the air when it passes, so tapping a
  little before the rope comes down is right, with a short grace for late taps. Full marks when the rope passes
  near the top of the jump, and a mistimed tap costs less.

## 0.9.1

- Block training gets 4% faster with each successful block, so a good run ends much faster than it starts.
- Recall training plays its pattern faster as the pet's Wits and life stage rise: from 600 ms per pad for a new
  child down to 380 ms for an adult at 100 Wits.

## 0.9.0

- Battles are rebalanced: no form wins most fights any more. With the same stat points, Power, Speed, Guard and
  Wits adults each win about half their fights, where Guard used to win almost all and Wits almost none.
- Each adult move now works best against one other form: Power Slam breaks Shell Up, Shell Up hurts attackers
  (bad news for Flurry's many hits), Flurry makes a slower foe flinch out of Focus and Mind Trick, and Mind Trick
  hits with the stronger of both pets' Power.
- Speed makes moving first likelier instead of certain, critical hits go through Shell Up, Focus is a light hit
  that powers up the next one, and elements matter a little less. Fights are a bit shorter.
- The computer opponent now uses Shell Up and picks moves by what they do. Live battles need both players on
  this version.

## 0.8.4

- The cleaning sweep is a little quieter.

## 0.8.3

- Cleaning an island that is already clean plays one soft broom stroke instead of nothing.

## 0.8.2

- The cleaning sweep is louder again, so it can be heard on a phone and over the music.

## 0.8.1

- Cleaning up sounds like a soft broom sweep instead of a slap.

## 0.8.0

- School time (Cozy and Gentle): in Settings, choose the school days and hours. During them the egg or pet is at
  day care: its needs wait, nothing calls, no care mistakes count and no alerts are sent, while it keeps growing.
  A ready egg waits for you instead of hatching on its own. Pick up brings it home early for the rest of the day.
  Classic stays as it is.

## 0.7.0

- Classic mode gets a health potion: each egg comes with one. If the egg or pet runs out of health, it collapses
  and fades for 24 hours instead of being lost at once. Give it the potion in time and it comes back weak (and it
  counts as 2 care mistakes). The egg and the pet that hatches from it share the one potion.
- You get an alert when it collapses and a reminder 4 hours before it's too late. Pets saved by the potion are
  marked in the family list. Pets you already have get a potion too.

## 0.6.1

- Shorter naps: a power nap lasts at most an hour, and a pet that ran out of energy naps for about an hour and a
  half instead of most of the afternoon. It doesn't get more energy from it, so training stays as it was.

## 0.6.0

- Wild creatures come as runts, even matches, strong ones and champions. Strong ones and champions have traits
  (tough, swift, fierce, rival), fight smarter and pay more: up to +5 stat points for beating a champion.
- The more a pet wins, the tougher the creatures it meets; after losses it meets weaker ones again.
- Before a wild fight you see what you found and can back off for free. Champions beaten count in the record.

## 0.5.1

- For PHP hosting: the server's secrets (stats token, push keys) can be kept outside the web folder, and are never
  handed out even if PHP stops working. Nothing changes in play.

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
