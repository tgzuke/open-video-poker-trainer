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
