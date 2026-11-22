# Progress

## Milestone 1 — Engine core (2026-11-21)

### Built
- **Repo and tooling.** `engine/` Rust crate (library, `ovp` CLI, wasm bindings
  via wasm-bindgen), `app/` Vite + TypeScript shell with the engine in a Web
  Worker, vitest, MIT license.
- **Data-driven games.** Game definitions (deck + ordered pay lines with rank /
  quad / kicker conditions) and pay tables (per-coin pays, max-bet overrides)
  are JSON in `data/`. Only 9/6 Jacks or Better ships so far (M2 adds the rest).
- **Hand evaluator** for natural five-card hands, on full or reduced decks.
- **Exact 32-hold EV.** For every deck subset of ≤4 cards the engine
  precomputes how many five-card hands contain it in each pay category; a
  hold's outcome counts then follow by inclusion–exclusion over the dealt hand
  (32 lookups + a Möbius transform). Everything is integer-exact; the tables
  don't depend on pay amounts, so bet size changes need no rebuild.
- **Full-game analysis** over the 134,459 suit-permutation classes, with
  returns as exact fractions, the optimal hold for every class, the outcome
  distribution, and the exact return of any (suit-symmetric) hold policy.
- **CLI:** `ovp analyze`, `ovp holds "<hand>"`, `ovp verify [--full]`, `ovp list`.

### Verified (SPEC §3.3) — all pass
| Check | How |
|---|---|
| Fast path = brute force | Every category count of all 32 holds identical to direct enumeration of every draw; 64 random hands in `cargo test`, 500 via `ovp verify`. |
| Probabilities sum to 1 | For all 134,459 classes × 32 holds, counts are ≥0 and sum to the number of draws; full-game outcome probabilities sum to exactly 1; class weights sum to C(52,5). |
| Suit-permutation invariance | 5,000 (test) / 25,000 (CLI) random hands with random suit relabelling give identical results. |
| Symmetry = no symmetry | Exact equality of optimal return, and of a sample strategy's return, on three reduced decks (20, 21 with 3 suits, 28 cards) and on the full 52-card deck. On the two smallest decks also equal to a fully brute-force computation that uses no tables. |
| Evaluator | Category totals over all 2,598,960 hands match the combinatorial counts. |
| Class count | Exactly 134,459 suit classes. |

**9/6 Jacks or Better, max bet:** optimal return **99.543904%**
(exact 1653526326983 / 1661102543100). Informational cross-check: matches the
commonly published 99.54%.

### Performance (Apple M4)
| | Native | WebAssembly (Node/V8) |
|---|---|---|
| Draw tables (once per game) | 118 ms, 3.2 MB | 230 ms |
| Full-game analysis | 103 ms | 199 ms |
| 32-hold EV, one hand | 0.8 µs | 1.6 µs (target: <10 ms) |

`cargo test`: ~14 s for the verification suite. `ovp verify --full`: ~34 s
(mostly the 500-hand brute-force comparison).

### Notes / open questions
- Exactly tied holds: the owner decided (after review) that they are
  equivalent choices; SPEC §3.1 updated. The engine still reports one
  representative best hold ("lowest mask"); M3 will expose the full tie set.
- Multi-hand deals and carried state (Ultimate X etc.) are not modelled yet:
  the engine API is per-hand and stateless, so the game model added in M2/M4
  can wrap it. Wild cards and jokers will need evaluator extensions (v1.x).
- Dev-only dependency note: Vite pulls in `lightningcss` (MPL-2.0) as a build
  tool; it is not shipped. All shipped/engine dependencies are MIT/Apache.
- Browser shell: confirmed working in a browser by the owner (EV table shows).

### For playtesting
Nothing yet (no game UI until M4).

## Milestone 2 — Game definitions (2026-11-21)

### Built
- **Four games as data:** Jacks or Better, Bonus Poker, Double Bonus, Double
  Double Bonus (`data/games/`). Generic default labels: "Jacks+ Poker",
  "Bonus", "Double Bonus", "Double Double Bonus". DDB's kicker quads are
  pay-line conditions (`quad_ranks`, `kicker_ranks`), not code branches.
- **Preset library, 20 pay tables** (`data/paytables/<game>.json`, one line
  per table): JoB 9/6 9/5 8/6 8/5 7/5 6/5; BP 8/5 7/5 6/5; DB 10/7 9/7 9/6 9/5
  9/6/4 9/5/4; DDB 9/6 9/5 8/5 7/5 6/5. `build.rs` registers every data file,
  so a new preset needs no code.
- **Bet size 1–5:** per-coin pays × bet; the royal is 250/coin below max bet
  and 4000 at max bet (`max_bet_pays`).
- **Progressive royal:** optional amount in whole credits; replaces the
  game's `progressive_line` at max bet only, and is ignored below max bet.
- **Custom tables:** engine validates any JSON table (every line paid once,
  no unknown lines, non-negative, right game). CLI: `--paytable-file`,
  `--set line=N`, `--set max:line=N`. Browser: custom variants saved in
  localStorage (`app/src/customTables.ts`); switching tables within a game
  reuses the draw tables (~0 ms, no rebuild).
- **CLI:** `ovp list`, `ovp analyze --all`, `--bet`, `--progressive`,
  `ovp verify --all`.
- Dev shell in the browser: preset/custom table picker, bet, progressive,
  editable pays with "Save custom".

### Verified — all pass (`cargo test`: 46 tests; vitest: 11; `ovp verify --all`: 49 checks)
- The whole §3.3 suite now runs for **every game**: fast path vs brute force,
  probabilities, suit invariance, and symmetry vs every deal on four reduced
  decks. A new 20-card deck (A,2,3,4,5 × 4 suits) makes ace and low quads
  with every kicker reachable, and it is checked against fully brute-force
  play with no tables.
- Pay-line unit tests for every bonus quad and DDB kicker combination.
- **Bet size (all 20 presets):** returns at bets 1–4 are exactly equal; max
  bet is higher (the 4000 royal).
- **Progressive (all 20 presets):** an amount equal to the base royal changes
  nothing. It's ignored below max bet. Raising it by Δ with the old holds
  kept raises the return by exactly P(royal)·Δ/bet (exact fractions). With
  re-optimised holds the return rises further, and the royal gets no less
  frequent. A test shows the optimal hold flipping (JJ → 3 to a royal) under
  a big progressive at max bet but not at bet 4.
- Custom table equal to a preset gives exactly the preset's return.
- Example, 9/6 JoB: bet 4 → 98.373457%, bet 5 → 99.543904%,
  progressive 6000 → 100.651332%, 8000 → 101.863527%.

### Results (max bet, optimal play)
| Table | Return | Published (info) |
|---|---|---|
| JoB 9/6 · 9/5 · 8/6 · 8/5 · 7/5 · 6/5 | 99.5439 · 98.4498 · 98.3927 · 97.2984 · 96.1472 · 94.9961 | all match |
| BP 8/5 · 7/5 · 6/5 | 99.1660 · 98.0147 · 96.8687 | all match |
| DB 10/7 · 9/7 · 9/6 · 9/5 · 9/6/4 · 9/5/4 | 100.1725 · 99.1065 · 97.8062 · 96.7264 · 96.3754 · 95.2738 | match where known (9/5: none on file) |
| DDB 9/6 · 9/5 · 8/5 · 7/5 · 6/5 | 98.9808 · 97.8729 · 96.7861 · 95.7120 · 94.6569 | match where known |

Investigation note: three of my first "published" figures came from memory
and didn't match (DB 9/6, DB 9/5, JoB 6/5). Checking sources showed the
96.38% I had for DB 9/5 belongs to the 9/6/4 table (straight pays 4). The
engine reproduces that and 9/5/4 (95.27%), so I fixed the data, added both
as presets, and now store only sourced figures at the precision given.

### Performance (native, M4)
Draw tables 90–120 ms per game; full analysis ~105–117 ms per table; all 20
presets in 2.3 s. wasm bundle 271 kB (98 kB gzip).

### Open questions / notes
- Progressive amounts are whole credits (keeps the math exact). If the UI
  wants dollars/cents with fractional credits, I'll scale internally.
- SPEC §3.1 says presets ship with precomputed results. Full analysis takes
  ~0.2 s in wasm, so for now nothing is precomputed for returns. Generated
  strategies (M3) will ship as files.
- Browser: dev server, assets and production build checked. The Chrome
  extension tools were not available in this session, so I haven't eyeballed
  the M2 shell controls in a real browser.

### For playtesting
Nothing yet (no game UI until M4).

**Update (M2 review, 2026-11-21):** owner confirmed progressive amounts stay
whole credits and nothing is precomputed for now. M2 shell checked in Chrome:
DDB 9/6 → 98.9808%; a custom DDB 8/5 saved in the page gives 96.7861%
(= preset), persists across reload; no console errors.

## Milestone 3 — Strategy layer (2026-11-21)

### Built
- **Rule language** (plain text, one rule per line; see
  [strategy-format.md](strategy-format.md)). It covers:
  - pat hands, including several on one line;
  - quads, trips and pairs by rank group, with DDB kickers;
  - draw families (royal / straight flush / flush / straight) with
    `w` (straights the cards fit) and `h` (high cards);
  - exact combinations ("QJ suited", "KQJ unsuited", "K");
  - "N high cards";
  - penalty qualifiers `fp` (flush) and `sp` (straight), and `prefer low`.
  Tie-break inside a rule: highest ranks, then fewest fp, then fewest sp.
- **Evaluator** (exact). It reports the return, the EV loss (credits/hand and
  points of return), per-rule fires / wrong / loss, undefined and ambiguous
  hands, and the costliest misplays.
- **Completeness checker:** every one of the 134,459 classes must resolve,
  with no ambiguity.
- **Generator** for all three tiers, run natively from the CLI and in the
  browser worker (wasm). It builds candidate rules from the game and the
  analysis, records what each rule would cost on every class, then searches.
  The search is greedy plus backward elimination from 10 starting points,
  with local moves, swaps, compound moves and "family bursts". Tiers are
  warm-started from the tier below and never worse than it.
- **60 shipped strategies** in `strategies/<paytable>/<tier>.txt` (20 presets
  × 3 tiers), with numbers in comments. CLI: `ovp strategy
  generate|eval|play|tidy`. Dev shell: strategy panel (preset or generate,
  per-rule table, deciding rule for a hand).

### Decisions made (owner asked for intelligent choices here)
- **Exact ties** (SPEC updated): no EV loss is charged for a hold exactly
  tied with the best one. Leftover choices within a rule that are exactly
  tied aren't ambiguous. In checking modes a tied hold counts as the same play.
- **Groups are counted as dealt:** "pair" is a rank dealt exactly twice. The
  first generator broke quads into "three of a kind"; this rule makes that
  impossible.
- **Every pat hand has a line in every tier**, so no strategy breaks a dealt
  royal for lack of a line. Several pat hands may share one line, which is
  what makes a 15-line beginner tier usable. The generator still decides
  where they go (4 to a royal over a pat flush, AAA+kicker over a full house
  in DDB).
- **Tier qualifiers:** beginner none; intermediate `fp` only; expert `fp` and
  `sp`. Caps 15 / 30 / 60 (defaults, in `generate.rs`).

### Verified — all pass (`cargo test`: 46 tests; vitest: 16)
- All 60 shipped strategies:
  - parse back and are complete;
  - recorded return equals a fresh exact evaluation;
  - within their tier's line cap and qualifier rules;
  - every pat hand covered;
  - beginner ≥ intermediate ≥ expert in loss.
- Class-based evaluation is exact. On four reduced decks × 2 games, playing
  the strategy on every single deal gives exactly the same return. Play is
  suit-symmetric on 20,000 random full-deck hands.
- The generator's internal loss equals the exact evaluator (to 1e-9) for
  every generated strategy. I hit one discrepancy during development
  (running-sum drift in the search), caught by this check and fixed.
- Ties: replacing every best hold with another exactly-tied hold leaves the
  exact return unchanged.
- Per-rule numbers add up to the totals. The checker flags undefined hands.
  `tidy` changes no play (checked on all 60 files).
- wasm: preset strategies evaluate to their recorded return; generation of
  all three tiers works in wasm (small custom deck in tests; full deck
  benchmarked below).

### Results (return %, max bet; loss vs optimal in credits/hand)
| Table | Optimal | Beginner (15) | Intermediate (30) | Expert (≤60) |
|---|---|---|---|---|
| JoB 9/6 | 99.5439 | 99.3292 (0.0107) | 99.5421 (0.00009) | 99.5436 (0.00001) |
| JoB 8/5 | 97.2984 | 97.0641 (0.0117) | 97.2939 (0.0002) | 97.2981 (0.00002) |
| BP 8/5 | 99.1660 | 98.8751 (0.0145) | 99.1620 (0.0002) | 99.1657 (0.00001) |
| DB 10/7 | 100.1725 | 99.6485 (0.0262) | 100.0813 (0.0046) | 100.1715 (0.00005) |
| DB 9/6 | 97.8062 | 97.3618 (0.0222) | 97.7544 (0.0026) | 97.7972 (0.00045) |
| DDB 9/6 | 98.9808 | 98.2990 (0.0341) | 98.9428 (0.0019) | 98.9796 (0.00006) |
| DDB 6/5 | 94.6569 | 94.0135 (0.0322) | 94.6106 (0.0023) | 94.6563 (0.00003) |

All 60 are in the file headers. Bonus games lose more at the beginner tier:
15 lines can't express their rank-dependent quads/trips play.

### Performance
- Generation (native, 10 search starts in parallel on 10 cores): ~3–7 s
  beginner, 7–15 s intermediate, 37–78 s expert per table; all 60 in ~20 min.
- WebAssembly (single thread, full deck, 9/6 JoB, older 5-start build):
  13 s beginner, 49 s intermediate, 156 s expert. The current 10-start
  search will take roughly twice that, about 7 minutes for all three tiers
  of a custom table.
- Exact evaluation of a strategy: ~0.5 s native, ~1.5 s wasm.

### Open questions
- **Custom-table generation time in the browser** (~7 min for all tiers). A
  "quick" mode with fewer search starts is easy if that's too slow. Worth
  deciding before M5/M6.
- **Tier caps** (SPEC open question): 15 lines costs bonus games 0.02–0.04
  credits/hand at beginner. Raising beginner to ~20 would help those games
  most.
- Expert DB 9/6, 9/5, 9/6/4 still lose 0.0001–0.0005 credits/hand. Other
  tables get to ~0.00002, so there is search headroom left there.
- Penalty qualifiers rarely win a line at the intermediate tier; the
  language may need finer qualifiers for experts later.

### For playtesting
- Whether the strategies read naturally (`w=`/`h=` notation; `prefer low`
  on "2 high cards" means "keep the two lowest", e.g. KQ from AKQ).

**M3 review (2026-11-21).** Owner decisions: ~7 min browser generation is
acceptable (rare event); expert weak spots accepted for now; keep the
shipped 15-line beginner strategies.
- **Tunable line cap** for custom strategies: `ovp strategy generate ...
  --max-lines N`, `maxLines` in the wasm/worker API, "Line cap" field in the
  dev shell (3–200). Example: DDB 8/5 beginner at 20 lines loses 0.0118
  credits/hand vs 0.0354 at 15.
- **Reading order fix.** Owner reported DDB 8/5 beginner listing "pair J-A"
  above "three of a kind", which reads as "break trip aces". Play was already
  right: "pair" means a rank dealt exactly twice, so trips are never broken.
  But the order of rules that never compete was arbitrary. A new pass sorts
  those rules by the average EV of their holds, moving one only past
  neighbours that never decide the same hands, so play can't change. Applied
  to all 60 shipped files with play verified unchanged (same holds, same
  exact return). Now trips read right under the pat hands. New tests cover
  the line cap and reading order (Rust 48 tests, vitest 16).

## Milestone 4 — Playable game (2026-11-21)

### Built
- **Cabinet screen** (`app/index.html`). An older-bartop look: deep blue
  field, yellow pay table in a red frame, current bet column highlighted,
  winning line lit (on the deal, and flashing after a win), HELD labels, red
  WIN / BET / CREDIT meters, game label.
  - All art is drawn in code: an original 5×7 pixel font, 9×9 suits, card
    faces and backs. Nothing is copied.
  - Rendered on a 480×270 pixel grid. Every pixel edge is rounded to device
    pixels, so it's crisp at any window size or full screen (16:9,
    letterboxed).
- **Free Play.** Deal/draw, holds, Bet One (cycles 1–5), Bet Max (deals),
  royal 250/coin below max bet and 4000 at max, optional progressive.
  Credits are play credits, auto-refilled to 1000 when they run out, and
  there's a reset in the menu. Credits and bet persist across reloads.
- **Game model** (`app/src/game/model.ts`). A pure state machine: an action
  returns the new state plus events, at once. Hands are a list and there's a
  `carry` slot for state between deals (multi-play / Ultimate X later; not
  implemented). Hand evaluation and pays come from the wasm engine via a
  lightweight `Rules` class with no lookup tables, so it's cheap on the UI
  thread.
- **Input layer.** Buttons go to actions. The keyboard source uses the
  default keymap in `app/src/config/keymap.ts` (Z X C V B, comma, M, N), and
  key-repeat and modifier keys are ignored. A pointer source (click a card to
  hold it) shows the layer works for other inputs; GPIO can plug in the same
  way later.
- **Animation and sound never gate input.** State changes on the key press;
  the card-flip and count-up timeline only affects what's drawn, and the
  next action skips it. Sound: synthesized Web Audio (deal, hold, bet, draw,
  win, count-up, buzz on a rejected press), muted by default.
- **Menu** (mouse). Game and pay table (presets and saved custom tables),
  game label rename, progressive, speed slider (slow → instant, default
  fast), sound on/off and volume, key remapping with conflict warning and
  reset, credits reset, full screen.
- The M1–M3 engine shell moved to `app/dev.html`.

### Verified
- **Acceptance (Chrome, real key events):** 40 hands at 0.78 s/hand, every
  press applied. Key handler 0.2 ms median / 0.8 ms max; key press to
  visible frame 16 ms median / 18.5 ms max (the next display frame); no
  frame over 50 ms. With sound on: 30 hands, ≤ 19.5 ms, no errors. At the
  slowest speed, 10 deal-hold-draw bursts sent with no gap were all applied
  at once.
- **vitest (31 tests, +15 for M4):**
  - deal / hold / draw order;
  - payouts match the engine's pay table and credits balance exactly over
    5,000 seeded hands (with random holds);
  - Bet One cycling, Bet Max deals, refill, rejected presses;
  - an action costs < 0.2 ms;
  - keymap matches the spec with no conflicts; keyboard source ignores
    repeats, modifiers and unknown keys, and is off while the menu is open;
  - the animation timeline never holds back the meters; a full hand
    including a royal count-up fits in 2 s at the default speed;
  - every pay line name of every game is drawable in the font and fits the
    column;
  - prefs round-trip and survive garbage or blocked storage.
- Rust: 48 tests still pass. Production build OK (game + dev shell).

### Performance
Model action < 0.2 ms; frame draw well under one 60 Hz frame (no long
frames observed). Game bundle 32 kB JS (11.5 kB gzip) + 271 kB wasm.

### Open questions
- Win line flashes until the next deal (like real machines); should it stop
  after a few seconds?
- The pay table is dense for Double Double Bonus (13 lines; rows are 8 px
  on the 270 px grid). Readable, but it's the tightest part of the screen.

### For playtesting (all in `config/feel.ts` or `config/keymap.ts`)
- Speed levels: ms per card reveal/flip, count-up rate and caps (fast:
  30 ms/card, 25 ms flip, 1200 credits/s, ≤ 1.2 s).
- Colors (`PALETTE`) and layout (`LAYOUT`), card art, font.
- Sound effects (pitches/lengths in `audio/sfx.ts`), default volume 0.35.
- Bet One on `N` (still provisional); clicking a card holds it.
- Auto-refill at 0 credits (`AUTO_REFILL`), starting credits 1000.

### M4 review
- Owner kept the endless win flash and the dense DDB pay table as is.
- Added a dealt-win chime: a short rising two-note cue (`Sfx.dealtWin`) when the dealt hand already pays, timed to the last card reveal. Verified in Chrome: it fired on exactly the 37 paying deals out of 200, with no errors.

## Milestone 5: Trainer

### What was built
- **Engine** (`strategy/trainer.rs`, wasm `setTrainerStrategy` / `dealCheck`):
  for each dealt hand, one call returns everything needed to judge any
  hold: exact EVs, exact-tie groups, the strategy's rule and hold, the rules
  that match the hand (in order), and the **rule distance** of all 32 holds.
  - Distance = position, in the per-hand list of matching rules, of the
    first rule that describes the player's hold exactly (SPEC §5.3).
  - A hold tied in EV with the strategy's is distance 0 (the same play).
  - No rule describes the hold: off-strategy.
  - Decision: the deciding rule's pattern but the wrong cards (e.g. KQ
    where the rule picks QJ) counts as distance 1: right rule, wrong cards.
- **Checking modes** (`trainer/grade.ts`):
  - Strategy (default): right iff the same play as the strategy.
  - Pure EV: right iff within the grace margin of the best hold. The margin
    is 0.05 credits at max bet, scaled by bet/max bet, and adjustable.
  - Without a preset strategy (custom pay tables), checking falls back to
    Pure EV and rule stats are off.
- **Modes** (`trainer/trainer.ts`):
  - **Lesson:** a wrong hold blocks the draw with a buzz.
    1. First mistake: "try again".
    2. Second mistake: the rule's name. If no rule describes the right
       play (Pure EV), it skips straight to step 3.
    3. Third mistake: green frames around the cards to hold, which must
       then be entered.
  - **Practice:** a permanent feedback box right of the cards; the cards
    shift left to make room.
    - The box shows CORRECT (green), CLOSE (yellow, distance 1), or
      WRONG / OFF STRATEGY (red).
    - It also shows the best play's rule and the credits it cost.
    - In Pure EV mode, a wrong play that still follows the strategy is
      yellow.
  - **Free Play:** no feedback.
  - Every mode records stats. In Lesson, stats judge the **first** hold
    tried.
- **Stats** (`trainer/stats.ts`, `store.ts`, `ui/statsView.ts`; STATS
  button). Session and lifetime are shown side by side, each with its own
  reset (two clicks).
  - Hands, credits bet and won, and actual return.
  - EV loss (1) vs optimal, (2) vs strategy, and (3) the strategy's own
    loss, in credits: totals and per hand. Metric (4) is still open
    (SPEC §5.4).
  - Deviations from the strategy.
  - Distance histogram (0, 1, 2, 3, 4+, off).
  - Results by pay line.
  - Misses, chances and miss rate per rule for the current strategy.
- **Persistence and settings:**
  - Stats are saved in IndexedDB, batched every 250 ms and on page hide.
    Session stats persist across reloads until you reset them.
  - The menu's Trainer section sets the mode, checking mode, strategy tier
    and grace margin. These are saved in prefs.
- **Engine worker:** the game page now has the engine worker for these
  checks. A check is asked for at deal time and normally arrives before
  Draw. If the player draws first, Lesson waits for it (queued);
  Practice and Free Play never wait.

### Verification
- Rust (52 tests pass):
  - The distance cases above, written by hand.
  - EV ties checked against the exact comparison.
  - Invariants on 3,000 random hands.
  - On 300 hands for each of the 60 shipped strategies, the deal check
    agrees with play.
- Vitest (45 tests pass):
  - Green, yellow and red grading.
  - Pure EV grace and its bet scaling.
  - Fallback when there's no strategy.
  - The Lesson sequence: wait, block, rule, marked cards, then the
    entered hold.
  - Practice with a late check; Free Play.
  - The game app's blocked and queued draws.
  - Stats sums, including (1) = (2) + (3).
  - Save, reload, reset, and malformed saved data.
  - Prefs.
- Checked in Chrome:
  - The Practice box and the Lesson hint frames.
  - Stats survived a page reload and the stats screen rendered.
  - I cleared my test hands afterwards.

### Performance (Chrome)
- Engine check per deal: 4.6 ms median, 5.7 ms max, round trip to the
  worker.
- Key handler: 0.4 ms median, 3 ms max.
- Input to frame: 2 ms median, 16 ms max.

### Open questions
- Stats metric (4) (SPEC §5.4), still undefined.
- "Right rule, wrong cards" counts as distance 1 (yellow). Should it be
  red instead?

### For playtesting (`config/trainer.ts`, `config/feel.ts`)
- Defaults: Practice mode, Strategy checking, the Intermediate strategy,
  and a 0.05 grace margin.
- Feedback box size and position (`LAYOUT.feedback`, `practiceCardsX`),
  its colors, and wording (CORRECT / CLOSE / WRONG / OFF STRATEGY).
- Lesson messages (`LESSON_TEXT`) and the green hint frame.
- Rule names are shown in plain words (e.g. "4 to an outside straight";
  table in `docs/strategy-format.md`). Files keep the exact notation.
- Session stats last until you reset them; they are not reset by time.

