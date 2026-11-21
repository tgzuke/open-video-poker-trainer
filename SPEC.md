# Open Video Poker Trainer — Project Spec

**Status:** pre-alpha · **License:** MIT (switching to GPL is acceptable if a needed dependency or asset requires it) · **Repo:** private until the public itch.io release

## 1. Vision

A free, open-source video poker trainer that **looks, sounds and plays like a classic bartop machine** and teaches **human-usable strategies** for whatever pay table the player is actually facing. It is a game and a training tool only. It never handles real money, purchases or anything resembling gambling.

Three problems with existing free trainers drive the design:

1. **Feel.** They don't look or play like real machines. The goal is full keyboard play at real machine speed (about one hand every 2 seconds) in an older-style red/blue/yellow pixel aesthetic.
2. **Configurability.** Few game families, and weak handling of the short pay tables found on real machines.
3. **Strategy.** Trainers either show only the optimal play or a fixed strategy. This one generates **tiered, easy-to-follow ranked strategies** for any pay table, scores their exact cost against optimal play, and trains the player against them.

The long-term goal is a home cabinet: a Raspberry Pi with GPIO buttons running the desktop build. That hardware layer is out of scope for now, but nothing in the design should block it.

## 2. Scope

### v1 (MVP)
- Single-hand play.
- Games: **Jacks or Better, Bonus Poker, Double Bonus Poker, Double Double Bonus Poker**.
- Preset pay table library, with saveable custom variants.
- Bet size of 1–5 coins (royal pays 250/coin below max bet and 4000 at max bet), plus an optional progressive royal amount.
- Exact-EV engine, strategy rule language, strategy evaluator and automated strategy generator.
- Three trainer modes (Lesson / Practice / Free Play) and two checking modes (Strategy-based / Pure EV).
- Session stats and long-term stats, stored locally, with a reset option.
- Configurable keyboard controls.
- Full-screen HTML5 build hosted on itch.io (alpha, for playtesting).

### v1.x (add once cheap; the engine should make these mostly data entry)
Bonus Poker Deluxe, Triple Double Bonus, Aces & Faces, Deuces Wild, Bonus Deuces Wild, Joker Poker, White Hot Aces, Super Aces.

### v2+
- Multi-play (Triple/Five/Ten Play).
- Export and import of pay tables, strategies and stats.
- Drill mode. Build it only if playtest data shows errors cluster around specific rules.
- Desktop build (Tauri or Electron) and the Pi cabinet with GPIO.
- Variance and bankroll simulation views.

### Explicitly out of scope for now, but don't block them
Ultimate X, Super Times Pay, Spin Poker and similar formats. **Engine requirement:** the game model must allow for *state that carries between hands* (e.g., multipliers) and *more than one hand per deal*, so these can be added without a rewrite. Don't implement them.

### Never
Real money, purchases, comps or player tracking. No copyrighted or trademarked assets.

## 3. Engine

### 3.1 Core math
- **Exact EV for all 32 holds** on any dealt hand, for any game definition, pay table and bet size. Target: well under 10 ms per hand in the browser, so Pure EV mode and the hint system run live with no perceptible lag.
- **Full-game analysis.** Use suit symmetry to reduce the 2,598,960 possible deals to about 134,459 distinct classes, then compute:
  - optimal-play return
  - the optimal hold for every class
- **Tied holds.** When two or more holds have exactly equal EV (compared as exact fractions), they are **equivalent choices**. "Optimal play" for a hand is the *set* of all max-EV holds, and any member of it costs 0 EV. Returns never depend on which tied hold is picked. Decided in milestone 3: strategy EV loss is charged only when the strategy's hold is strictly worse than the best; a rule's leftover choices that are exactly tied are not ambiguous; in checking modes a player hold exactly tied with the expected hold is the same play (§5.1).
  - the exact return of any given strategy

  Never use simulation to grade a strategy. The calculation is exact.
- Runs in a **Web Worker** so the UI never freezes. Preset pay tables ship with precomputed results. Custom tables compute on demand with a progress indicator and are cached locally.
- **Implementation:** Rust compiled to WebAssembly (preferred, for speed), with a thin TypeScript wrapper. The engine has **no UI dependencies** and must also run headless from the command line, for strategy searches and tests.

### 3.2 Game definitions are data
Each game is a definition containing:
- the deck (including any wild cards)
- hand categories and how to rank them
- the pay table, per coin for each bet size
- the royal and progressive rules
- any special conditions (e.g., four-of-a-kind kickers in DDB)

Adding a v1.x game should be mostly data plus small evaluator extensions (wild cards, kickers).

### 3.3 Verification
Correctness is checked **internally**, not against published figures, which are treated with skepticism:
- the fast EV path must match brute-force enumeration on large random samples of hands
- probabilities must sum to 1
- results must be the same for suit-permuted hands
- the full-game return must be identical whether computed with or without the suit-symmetry reduction (on reduced test cases)

Published returns (e.g., 9/6 Jacks or Better) may be logged as an informational cross-check. A mismatch is a reason to investigate, not an automatic failure.

## 4. Strategy layer

### 4.1 Rule language
A strategy is a **ranked hold list**, the traditional human-readable format, but machine-precise.
- Each rule is a **hold pattern**: "Four to a Royal Flush", "Suited QJ", "3 to a Straight Flush, type 2", "Two Pair", "Unsuited KQJ", and so on. Optional **qualifiers** cover penalty cards and exceptions ("…with no flush penalty", "…unless holding a 10").
- **Evaluation:** for a dealt hand, the strategy goes down the list. The first rule that matches some subset of the hand decides the hold.
- **Determinism:** if one rule can match more than one subset (e.g., two choices of "two high cards"), the rule must define a tie-break, or the analyzer flags it as **ambiguous**. A rule that matches several subsets which are exactly tied in EV (§3.1, e.g. suit-symmetric choices) is not ambiguous: the choices are equivalent.
- **Completeness:** the analyzer checks that every one of the ~134k classes resolves to exactly one hold. The final line is always "Discard everything", and the analyzer confirms there are no undefined or ambiguous hands.
- The format is plain text or JSON in the repo, readable by humans and diff-friendly.

### 4.2 Evaluator
For any strategy and pay table, it reports:
- the exact return
- EV loss against optimal play, in credits per hand and as a percentage of return
- for each rule: how often it fires, and the total EV lost on the hands where it disagrees with optimal play

### 4.3 Automated generator
- **Goal:** for a given pay table and bet size, find the strategy with the smallest EV loss against optimal play, within a line cap.
- **Tiers** (caps are configurable; these are the defaults):
  - **Beginner:** up to 15 lines, no penalty-card qualifiers
  - **Intermediate:** up to 30 lines, a limited set of qualifiers
  - **Expert:** up to 60 lines, any qualifiers
- **Search:** start from a library of candidate rules. Use local search (insert, delete, swap, merge, add or remove qualifiers) scored by the exact evaluator.
- No human in the loop. The output is the winning list and its numbers, with **no prose explanation**.
- Must run in the browser, in a worker, for custom pay tables. Preset strategies are generated offline from the command line and shipped with the game.
- We generate our own strategies. Do not copy published strategy lists verbatim.

### 4.4 Strategy editor (milestone 6)
- Reorder, add, remove and edit rules.
- The evaluator reruns live and shows the change in return and EV loss.
- The completeness checker shows any undefined or ambiguous hands.

### 4.5 Pay table comparison screen (milestone 6)
A separate screen, outside the game flow, showing how the strategy for pay table A differs from pay table B: rules added, removed or moved, and the EV effect of each. The main use is showing what changes on a short-pay machine compared with the full-pay version.

## 5. Trainer

### 5.1 Checking modes
- **Strategy-based (default):** a play is right or wrong according to the loaded strategy. There are no ties.
- In both modes, a hold that is exactly tied in EV with the expected hold (§3.1) counts as the same play.
- **Pure EV:** a play is right if its EV is within a **grace margin** of the best hold. Default: 0.05 credits at max bet, scaled with bet size, adjustable in Settings. Tune after playtesting.

### 5.2 Trainer modes
- **Lesson:** a wrong hold blocks the draw.
  1. First mistake: no hint; the player tries again.
  2. Second mistake: show the name of the rule that should have applied.
  3. Third mistake: show the correct hold, and make the player enter it before drawing.
- **Practice:** nothing blocks play. A permanent feedback box beside the cards shows:
  - 🟢 **green:** the play was correct
  - 🟡 **yellow:** the player applied the *next applicable* rule (distance 1)
  - 🔴 **red:** distance 2 or more, or off-strategy
- **Free Play:** no on-screen feedback. Everything is tracked for stats.

### 5.3 Rule distance
For the dealt hand, list **only the rules that match it**, in rank order.
- **Distance** is how far the rule matching the player's hold sits from the rule the strategy chose, counted within that list.
- If the player's hold matches no applicable rule, it is **off-strategy** and is always red.
- Yellow is based on this per-hand list, not on adjacency in the printed strategy.

### 5.4 Stats
All EV figures are in **credits**. Both session and lifetime figures are tracked, stored locally (IndexedDB), and can be reset.
1. EV loss of the player's play against optimal play.
2. EV loss of the player's play against the strategy's play.
3. EV loss of the strategy's play against optimal play (the strategy's built-in cost).
4. Relative EV loss. **OPEN QUESTION:** as originally written ("play loss − strategy loss"), this is (1) − (3), which is always equal to (2). Decide whether (4) should instead be a ratio, e.g., play loss ÷ strategy loss, or something else. Until decided, show (1)–(3) only.

Also tracked:
- the number of deviations from the strategy
- for each rule: misses, opportunities and miss rate (misses ÷ opportunities)
- a histogram of distances, including off-strategy plays
- hands played, results and credits

## 6. Presentation

### 6.1 Look
- Inspired by **older-era bartop machines**: deep blue play field, yellow/red/white pay table, chunky pixel lettering, pay table line highlighted on a win, a "HELD" indicator, and credit and bet meters.
- **Original assets only.** Use vector-rendered pixel art (SVG or canvas drawn from code) so it scales crisply. Fonts must be open-licensed (e.g., OFL) or drawn by us. No IGT or other trademarked art, fonts or sounds.
- Target 16:9, full screen. Not designed for phones.
- **Game names:** generic labels by default ("Jacks+ Poker", "Bonus", "Double Bonus", "Double Double Bonus"…). The player can rename labels in Settings.

### 6.2 Sound
Simple chiptune-style sound effects, synthesized with the Web Audio API so there are no licensing issues: deal, hold, draw, win and credit count-up. **Default: muted.**

### 6.3 Speed
Animation and credit count-up speed are controlled by a slider. **Default: fast.** The game must comfortably sustain one hand every 2 seconds or faster, and keyboard input must never wait on an animation.

### 6.4 Controls
Defaults live in **one obvious config file**, so they're easy to change after playtesting. Keys can also be remapped in Settings.

| Action | Default key |
|---|---|
| Hold/unhold card 1–5 | `Z` `X` `C` `V` `B` |
| Deal / Draw | `,` (comma) |
| Bet Max (also deals) | `M` |
| Bet One | `N` (provisional) |

Holds toggle. Menus (stats, settings, game and pay table selection, strategy screens) are mouse-driven. Input goes through an abstraction layer, so GPIO buttons can be added later without touching game logic.

## 7. Tech and packaging
- **Engine:** Rust compiled to WebAssembly (`wasm-pack`), plus a command-line tool for offline strategy generation and analysis.
- **App:** TypeScript + Vite, static build, with no backend.
- **Deploy:** a zipped HTML5 build uploaded to itch.io (full screen). Later, the same build wrapped with Tauri or Electron for desktop and the Pi.
- **Persistence:** IndexedDB/localStorage only.

## 8. Milestones

Each milestone has acceptance criteria. Don't start the next one until the current one's tests pass.

1. **Engine core.** Hand evaluator, exact EV for all 32 holds, full-game analysis with suit symmetry, and a command-line tool. *Done when:* the verification suite in §3.3 passes and the CLI prints optimal return and timing for 9/6 Jacks or Better.
2. **Game definitions.** JoB, BP, DB and DDB with a preset pay table library, custom tables, bet size and progressive royal. *Done when:* the CLI analyzes every preset, and changing the bet size or progressive amount changes the results correctly.
3. **Strategy layer.** Rule language, completeness/ambiguity checker, evaluator, and the generator for all three tiers. *Done when:* generated Beginner, Intermediate and Expert strategies exist for every preset, all are complete, and each one's EV loss is reported.
4. **Playable game.** Cabinet UI, keyboard controls, Free Play, sound and speed settings. *Done when:* a human can play at about one hand every 2 seconds with no input lag.
5. **Trainer.** Checking modes, Lesson and Practice modes, the feedback box, rule distance and stats. *Done when:* all mode behaviours in §5 work and stats persist across reloads.
6. **Strategy editor and comparison screen.**
7. **itch.io alpha build.**

## 9. Open questions
- Stats metric (4): its definition (§5.4).
- Bet One default key (`N` is provisional).
- Exact tier caps and which qualifiers each tier allows (tune with the generator's results).
- Default grace margin in Pure EV mode (tune after playtesting).
