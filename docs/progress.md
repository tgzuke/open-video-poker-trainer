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
