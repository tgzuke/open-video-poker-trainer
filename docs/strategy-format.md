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
| `RULE, RULE, ...` | several rules on one line (see "Merged lines" below) |
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

### How rules are shown in the game

Files (and anything written by hand) always use the notation above. The
game translates it into plain words when it shows a rule (feedback box,
Lesson hints, stats screen); the stats screen shows the file notation on
hover. Display only: the parser does not accept the plain words.

| File notation | Shown in the game |
|---|---|
| `4 to a straight w=2` | 4 to an outside straight |
| `4 to a straight w=1` | 4 to an inside straight (also J-Q-K-A, which fits only one straight) |
| `w=N` on other draws | N ways (`3 to a straight flush w=2` → 3 to a straight flush, 2 ways) |
| `h=N` | N high cards (`h=0` → no high cards) |
| `fp=0` / `sp=0` | no flush penalty / no straight penalty |
| `fp>=1` / `sp>=1` | flush penalty / straight penalty |
| `fp>=2` / `sp>=2` | 2+ flush penalty / 2+ straight penalty |
| `prefer low` | keep the lowest |
| `pair J-A` / `pair 2-T` | pair, J or better / pair, 10 or lower |
| `pair A`, `three of a kind A`, `four of a kind A kicker 2-4` | pair of aces, three aces, four aces, kicker 2-4 |
| all six pat hands on one line | any pat hand (shorter lists say "quads") |
| `T` in exact ranks (`KQJT suited`) | 10 (KQJ10 suited) |

### Merged lines

Several rules can share a line, separated by `, ` (comma and space):
`full house, 4 to a royal` or `flush, straight, three of a kind`. The
generator joins adjacent rules only when **no hand that reaches the line
matches two of them**, so they never compete and the line can be read in
any order: hold whichever one the hand has. A merged line counts as
**one line** toward a tier's cap.

Play never depends on the grouping. The rules are still tried in the order
written (left to right, then down), so a hand-written line whose rules do
overlap still plays the same as writing them one per line. Pat hands next
to each other on a line read as one combined pat rule.

In the game, a merged line is one step of rule distance, and the feedback
box and stats name only the rule on the line that applied.

### When a rule matches several card sets

The rule keeps the **highest ranks** (or lowest, with `prefer low`), then the
set with the fewest flush-penalty cards, then the fewest straight-penalty
cards. Whatever is still tied can only be the same ranks in swapped suits. If
those choices have exactly equal EV they are equivalent (SPEC §3.1).
Otherwise the analyzer reports the hand as **ambiguous**. No generated
strategy has ambiguous hands.

## Simplification

Every generated list is written in the plainest wording that plays every
hand **identically**. A qualifier is left out when it changes no hold:

- **by definition:** a 3-card royal draw always has 2 or 3 high cards, so
  `3 to a royal h=2` followed by `3 to a royal` is just `3 to a royal`;
- **by position:** once every 3 to a royal has been taken above, a 4-flush
  left over can't have 3 high cards, so `4 to a flush h=2`, `h=1`, `h=0`
  in a row is just `4 to a flush`. Likewise `4 to a straight w=1 h=3`
  reads `4 to a straight h=3` below the outside straights: read a rule as
  "of the hands still left at this line".

Nothing is listed by hand. Each rewrite (drop a qualifier; collapse rules
that differ only in one qualifier's value; merge a rule into a plainer
copy of itself below) is checked by exact enumeration and kept only if
every one of the ~134k hand classes gets the **identical hold** (an
equal-EV hold doesn't count), no rule is left with a new tie, and the list
needs no more lines. The fewest qualifiers win, then the shortest text,
then the fewest lines. Return and loss are unchanged to the last digit.

Qualifiers this can drop: `w=`, `h=`, `fp`, `sp`, `prefer low`, a rank set
on pairs, trips and quads, and `suited`/`unsuited` on `N high cards`. The
suitedness of exact cards (`KQ suited`) is part of the rule's name and stays.

`ovp strategy simplify FILE... [--renames strategies/rule-renames.json]`
rewrites lists in place and re-scores them (no regeneration). The renames
file maps each shipped list's old rule text to the rule that now decides
those hands, so the game carries saved per-rule stats over. Your own
strategies are never rewritten.

## Your own strategies

The strategy editor (Menu > Strategy editor) saves one strategy of your
own per pay table, in this same format. Its header says `tier: custom` and
records its exact return and loss at max bet. Choose "My strategy" as the
trainer's strategy to practise against it. Export writes the file.

## Comparing two strategies

`ovp strategy compare A.txt B.txt -p TABLE_B` and the Compare pay tables
screen show how list B differs from list A, judged on table B:

- Combined pat-hand lines are first split into one line per hand, and
  repeated rules are dropped. Neither changes play.
- Rules are matched exactly. A rule only in A is **removed**, a rule only
  in B is **added**, and a rule in both that falls outside their longest
  common subsequence is **moved**.
- The changes are applied to A's list from the top until it is B's list.
  Each change's effect is the change in exact return on table B from the
  list before it to the list after it, so the effects add up to (B on B)
  − (A on B).
- Hands played differently (holds of different EV) are grouped by the
  rule that decides them in A and in B. Each group shows its share of
  deals and its effect, and these add up to the same total.

## Tiers (defaults; configurable in `engine/src/strategy/generate.rs`)

| Tier | Lines | Qualifiers |
|---|---|---|
| Beginner | 20 | none |
| Intermediate | 25 | `fp` only |
| Expert | 40 | `fp` and `sp` |

Lines include `discard everything`, and a merged line counts once. Every
strategy has a rule for each pat hand (royal flush … straight), so none
leaves a dealt pat hand without a rule. The generator still decides where
those rules go: for example, `4 to a royal` above `flush` breaks a flush
for a royal draw.

The generator also:
- **prunes dead rules:** a rule worth less than 0.0000001 credits/hand
  (`DEAD_RULE`) is dropped, and its line goes to the next best candidate;
- **guards full houses:** a dealt full house is never broken unless that
  is an optimal play. In Double Bonus and Double Double Bonus, breaking
  aces full to hold the three aces is optimal, so `three of a kind A` may
  sit above `full house` there. A general `three of a kind` or `pair` rule
  never does.
