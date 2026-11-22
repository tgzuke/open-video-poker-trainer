# Publishing on itch.io

## Build

```sh
cd app
npm run build:itch
```

This rebuilds the engine (wasm), type-checks, runs the app tests, builds the
game page only (no engine dev shell) and writes:

- `release/open-video-poker-trainer-<version>-html5.zip`: upload this. It
  has `index.html` at its root, relative paths only, and about 65 files
  (~260 kB zipped).
- The packer refuses to write the zip if `index.html` is missing, a dev page
  slipped in, a path is absolute, or itch.io's file-count or size limits are
  exceeded.

The version comes from `app/package.json` and is shown at the bottom of
the in-game menu.

## Upload (you do this; it needs your itch.io account)

1. itch.io → Dashboard → **Create new project**.
2. **Kind of project:** HTML.
3. **Uploads:** upload the zip and tick **"This file will be played in the
   browser"**.
4. **Embed options:**
   - Viewport dimensions: **960 × 540** (16:9; the game scales to any
     size).
   - **Fullscreen button:** on (the game also has Full screen in its menu).
   - **Mobile friendly:** off (SPEC §6.1: not designed for phones).
   - Automatically start on page load: either. Players click the game once
     to give it keyboard focus.
   - Scrollbars: off.
5. **Pricing:** No payments (free). Don't enable donations: the game must
   not look like it involves money.
6. **Visibility:** start with **Restricted** or **Draft** for the alpha, then
   Public when ready.
7. **Screenshots:** `release/screenshots/` (Practice feedback, strategy
   view).
8. **Classification / genre:** "Educational", or "Card Game" under games.
   The text below states that it is not gambling.

## Suggested page text

> **Open Video Poker Trainer** (alpha)
>
> Practise video poker strategy with exact math. Pick a game (Jacks+ Poker,
> Bonus, Double Bonus, Double Double Bonus) and a pay table, then play with
> a trainer that checks every hold:
>
> - **Practice:** a feedback box grades each play (correct / close / wrong)
>   and shows the best play and what your choice cost.
> - **Lesson:** a wrong hold blocks the draw. Try again, then get the
>   rule's name, then the cards to hold.
> - **Free Play:** no hints, just play.
>
> Strategies come in Beginner, Intermediate and Expert levels for every pay
> table. Press **S** to read the current one. Every number comes from exact
> enumeration of all draws, not simulation. Stats track your EV loss
> against optimal play and against the strategy.
>
> **Keys:** Z X C V B hold cards 1–5; comma deals or draws; M bets max; N
> bets one; S shows the strategy. Keys can be remapped in MENU.
>
> This is a training tool, **not a gambling product**: no real money, no
> purchases, play credits only. Free and open source (MIT License); all art,
> font and sounds are original.

## How the build was checked

The zip was unpacked into a nested folder (`/html/<id>/`, like itch.io's
CDN) on one origin and embedded in an iframe from a different origin, like
itch.io's page:

- the game, worker and wasm load with no console errors;
- the on-screen STATS and MENU buttons work;
- settings persist across reloads inside the iframe;
- stats persist (IndexedDB) on the build's origin;
- keys work once the game has focus (a click focuses it).
