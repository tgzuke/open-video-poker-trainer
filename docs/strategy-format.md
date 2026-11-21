# Strategy format

A strategy is a ranked hold list in a plain-text file, one rule per line,
best first. For each dealt hand, go down the list: the **first rule that
describes some cards in the hand** decides what to hold. The last line is
always `discard everything`.

`#` starts a comment. Generated files carry their numbers in comments: the
header has the game, pay table, bet, tier, return and loss; each rule line
ends with how often it decides the hand, how often its hold is not optimal,
and the EV it gives up (credits per hand dealt).

## Rules

| Rule | Hold |
|---|---|
| `royal flush`, `straight flush`, `full house`, `flush`, `straight` | the dealt pat hand (all five) |
| `royal flush, straight flush, four of a kind, full house` | any of several pat hands, on one line (quads: hold the four) |
| `four of a kind [RANKS] [kicker RANKS]` | the quads; with `kicker`, also the fifth card if its rank is listed |
| `three of a kind [RANKS] [kicker RANKS]` | the trips (and a listed kicker) |
| `two pair` | both pairs |
| `pair [RANKS]` | the pair |
| `4 to a royal`, `3 to a royal` | suited cards, all T or higher |
| `N to a straight flush` | suited cards that fit a straight (not a royal draw) |
| `N to a flush` | suited cards that fit no straight |
| `N to a straight` | not all one suit, fits a straight |
| `QJ suited`, `KQJ unsuited`, `K` | exactly these ranks (single cards have no suitedness) |
| `N high cards [suited\|unsuited]` | N cards, all high (a rank that pays as a pair: J or better) |

`RANKS` is a set like `A`, `J-A`, `2-4`, `A,2-4`.

**Pairs, two pair and trips are counted as dealt.** `pair` means a rank
dealt exactly twice (it may be the pair of a full house or one pair of two
pair). It never means two cards out of trips or quads, so a strategy can't
accidentally break trips into a pair.

### Options on draw rules

| Option | Meaning |
|---|---|
| `w=N` | the held ranks fit exactly N different straights (5-rank windows A-5 … T-A). `4 to a straight w=2` is open-ended, `w=1` inside. QJ fits 3, KQ 2, AK 1 |
| `h=N` | N of the held cards are high cards |
| `fp=0`, `fp>=1`, `fp>=2` | flush penalty: number of **discarded** cards of the held suit |
| `sp=0`, `sp>=1`, `sp>=2` | straight penalty: number of discarded cards that would fit a straight with the held ranks |
| `prefer low` | when several card sets match, keep the lowest ranks instead of the highest |

### When a rule matches several card sets

The rule keeps the **highest ranks** (or lowest, with `prefer low`), then the
set with the fewest flush-penalty cards, then the fewest straight-penalty
cards. Whatever is still tied can only be the same ranks in swapped suits. If
those choices have exactly equal EV they are equivalent (SPEC §3.1).
Otherwise the analyzer reports the hand as **ambiguous**. No generated
strategy has ambiguous hands.

## Tiers (defaults; configurable in `engine/src/strategy/generate.rs`)

| Tier | Lines | Qualifiers |
|---|---|---|
| Beginner | 15 | none |
| Intermediate | 30 | `fp` only |
| Expert | 60 | `fp` and `sp` |

Lines include `discard everything`. Every strategy has a line for each pat
hand (royal flush … straight), so none leaves a dealt pat hand without a
rule. The generator still decides where those lines go: for example,
`4 to a royal` above `flush` breaks a flush for a royal draw.
