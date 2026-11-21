//! Full-game analysis.
//!
//! Hands that differ only by a relabelling of suits have identical hold EVs,
//! so we analyse one representative per suit-permutation class and weight it
//! by the class size. For the standard deck that is 134,459 classes instead
//! of 2,598,960 deals.
//!
//! A hand's representative: write each suit's rank set as a bitmask; the hand
//! is canonical when the masks are non-increasing in suit order. Every class
//! has exactly one such member, and its size is suits! / Π(multiplicity!) over
//! groups of equal masks.
//!
//! Returns are exact rationals: every hold EV is an integer over C(n−5, k),
//! so all sums are kept over the LCM of those denominators.

use crate::cards::Card;
use crate::combin::{choose, for_each_combination, gcd_i128, lcm_i128};
use crate::draw::{DrawTables, HoldCounts, HoldEvs};
use crate::game::Game;

/// Exact non-negative rational number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ratio {
    pub num: i128,
    pub den: i128,
}

impl Ratio {
    pub fn new(num: i128, den: i128) -> Ratio {
        assert!(den != 0);
        let g = gcd_i128(num, den).max(1);
        let s = if den < 0 { -1 } else { 1 };
        Ratio {
            num: s * num / g,
            den: s * den / g,
        }
    }
    pub fn from_int(n: i128) -> Ratio {
        Ratio { num: n, den: 1 }
    }
    pub fn add(self, o: Ratio) -> Ratio {
        let l = lcm_i128(self.den, o.den);
        Ratio::new(self.num * (l / self.den) + o.num * (l / o.den), l)
    }
    pub fn mul(self, o: Ratio) -> Ratio {
        let g1 = gcd_i128(self.num, o.den).max(1);
        let g2 = gcd_i128(o.num, self.den).max(1);
        Ratio::new(
            (self.num / g1) * (o.num / g2),
            (self.den / g2) * (o.den / g1),
        )
    }
    pub fn to_f64(self) -> f64 {
        self.num as f64 / self.den as f64
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HandClass {
    /// Representative hand, cards ascending.
    pub cards: [Card; 5],
    /// Number of deals in this suit-permutation class.
    pub weight: u32,
}

/// One representative per suit-permutation class, in colex order.
pub fn canonical_classes(game: &Game) -> Vec<HandClass> {
    let deck = game.deck();
    let suits = deck.suits() as usize;
    let fact = [1u32, 1, 2, 6, 24];
    let all: Vec<u8> = (0..deck.size() as u8).collect();
    let mut out = Vec::new();
    for_each_combination(&all, 5, |h| {
        let mut masks = [0u16; 4];
        for &c in h {
            masks[deck.suit(c) as usize] |= 1 << deck.rank_index(c);
        }
        if (1..suits).any(|s| masks[s] > masks[s - 1]) {
            return;
        }
        let mut stab = 1u32;
        let mut run = 1usize;
        for s in 1..=suits {
            if s < suits && masks[s] == masks[s - 1] {
                run += 1;
            } else {
                stab *= fact[run];
                run = 1;
            }
        }
        out.push(HandClass {
            cards: [h[0], h[1], h[2], h[3], h[4]],
            weight: fact[suits] / stab,
        });
    });
    out
}

/// Common denominator for every hold EV on this deck: lcm C(n−5, k), k ≤ 5.
fn ev_lcm(deck_size: usize) -> i128 {
    (0..=5).fold(1i128, |l, k| lcm_i128(l, choose(deck_size - 5, k) as i128))
}

/// Accumulates Σ weight × EV exactly, scaled by the common denominator.
struct Accum {
    lcm: i128,
    sum: i128,
    weight: i128,
    cat: Vec<i128>,
}

impl Accum {
    fn new(deck_size: usize, ncat: usize) -> Accum {
        Accum {
            lcm: ev_lcm(deck_size),
            sum: 0,
            weight: 0,
            cat: vec![0; ncat],
        }
    }
    fn add(&mut self, weight: u32, counts: &HoldCounts, evs: &HoldEvs, hold: usize) {
        let w = weight as i128;
        let scale = self.lcm / evs.draws[hold] as i128;
        self.sum += w * evs.numer[hold] as i128 * scale;
        self.weight += w;
        for c in 0..counts.ncat {
            self.cat[c] += w * counts.counts[hold][c] as i128 * scale;
        }
    }
}

#[derive(Clone, Debug)]
pub struct GameResult {
    /// Expected credits returned per credit bet.
    pub ret: Ratio,
    /// Probability of finishing in each outcome category.
    pub category_probs: Vec<Ratio>,
    /// Total deals weighed (must equal C(n,5)).
    pub deals: i128,
}

impl Accum {
    fn finish(self, bet: u32) -> GameResult {
        let den = self.lcm * self.weight;
        GameResult {
            ret: Ratio::new(self.sum, den * bet as i128),
            category_probs: self.cat.iter().map(|&c| Ratio::new(c, den)).collect(),
            deals: self.weight,
        }
    }
}

/// Precomputed engine for one game: tables plus suit classes.
pub struct Analyzer {
    pub game: Game,
    pub tables: DrawTables,
    pub classes: Vec<HandClass>,
}

/// Full-game result under optimal play, with the best hold of every class.
pub struct OptimalAnalysis {
    pub result: GameResult,
    /// Best hold mask for `classes[i]` (bit j keeps `classes[i].cards[j]`).
    pub best_holds: Vec<u8>,
}

impl Analyzer {
    pub fn new(game: Game) -> Analyzer {
        let tables = DrawTables::build(&game);
        let classes = canonical_classes(&game);
        Analyzer {
            game,
            tables,
            classes,
        }
    }

    pub fn hold_evs(&self, hand: &[Card; 5], pays: &[i64]) -> HoldEvs {
        self.tables.hold_counts(&self.game, hand).evs(pays)
    }

    /// Optimal-play return, using the suit-symmetry reduction.
    pub fn optimal(&self, pays: &[i64], bet: u32) -> OptimalAnalysis {
        let mut acc = Accum::new(self.tables.deck_size(), self.game.num_categories());
        let mut best_holds = Vec::with_capacity(self.classes.len());
        for cl in &self.classes {
            let counts = self.tables.hold_counts(&self.game, &cl.cards);
            let evs = counts.evs(pays);
            let best = evs.best();
            acc.add(cl.weight, &counts, &evs, best);
            best_holds.push(best as u8);
        }
        OptimalAnalysis {
            result: acc.finish(bet),
            best_holds,
        }
    }

    /// Exact return of a hold policy. The policy must be suit-symmetric (a
    /// rule-based strategy is), since only class representatives are asked.
    pub fn policy_return<F: Fn(&[Card; 5]) -> usize>(
        &self,
        pays: &[i64],
        bet: u32,
        policy: F,
    ) -> GameResult {
        let mut acc = Accum::new(self.tables.deck_size(), self.game.num_categories());
        for cl in &self.classes {
            let counts = self.tables.hold_counts(&self.game, &cl.cards);
            let evs = counts.evs(pays);
            acc.add(cl.weight, &counts, &evs, policy(&cl.cards));
        }
        acc.finish(bet)
    }

    /// Exact return when class `i` is played with hold `holds[i]`.
    pub fn holds_return(&self, pays: &[i64], bet: u32, holds: &[u8]) -> GameResult {
        assert_eq!(holds.len(), self.classes.len());
        let mut acc = Accum::new(self.tables.deck_size(), self.game.num_categories());
        for (cl, &m) in self.classes.iter().zip(holds) {
            let counts = self.tables.hold_counts(&self.game, &cl.cards);
            let evs = counts.evs(pays);
            acc.add(cl.weight, &counts, &evs, m as usize);
        }
        acc.finish(bet)
    }

    /// Optimal return over every deal, without the symmetry reduction.
    pub fn optimal_without_symmetry(&self, pays: &[i64], bet: u32) -> GameResult {
        let mut acc = Accum::new(self.tables.deck_size(), self.game.num_categories());
        let all: Vec<u8> = (0..self.tables.deck_size() as u8).collect();
        for_each_combination(&all, 5, |h| {
            let h = [h[0], h[1], h[2], h[3], h[4]];
            let counts = self.tables.hold_counts(&self.game, &h);
            let evs = counts.evs(pays);
            acc.add(1, &counts, &evs, evs.best());
        });
        acc.finish(bet)
    }
}

/// Optimal return computed with no tables and no symmetry: every draw of
/// every hold of every deal is classified directly. Only feasible on small
/// decks; this is the fully independent reference.
pub fn optimal_brute_force(game: &Game, pays: &[i64], bet: u32) -> GameResult {
    let n = game.deck().size();
    let mut acc = Accum::new(n, game.num_categories());
    let all: Vec<u8> = (0..n as u8).collect();
    for_each_combination(&all, 5, |h| {
        let h = [h[0], h[1], h[2], h[3], h[4]];
        let counts = crate::draw::brute_force_hold_counts(game, &h);
        let evs = counts.evs(pays);
        acc.add(1, &counts, &evs, evs.best());
    });
    acc.finish(bet)
}
