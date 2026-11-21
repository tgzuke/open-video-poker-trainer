//! Exact draw outcomes for all 32 holds — the fast path.
//!
//! Method. For every subset U of the deck with |U| ≤ 4 we precompute
//! `T[U][c]`: the number of five-card hands that contain U and fall in
//! outcome category c. For a dealt hand D and hold S ⊆ D, the reachable final
//! hands are those containing S and none of the discards D∖S. By
//! inclusion–exclusion,
//!
//!   N_S[c] = Σ_{S ⊆ U ⊆ D} (-1)^{|U∖S|} T[U][c],
//!
//! i.e. a Möbius transform over the 32 subsets of D. That is 32 table
//! lookups and ~80·categories additions per hand, all in exact integers.
//!
//! The tables depend only on the deck and how hands map to pay lines, not on
//! payout amounts, so changing bet size or pay values needs no rebuild.

use crate::cards::Card;
use crate::combin::{BINOM, choose, for_each_combination};
use crate::game::{Game, MAX_CATEGORIES};

pub const NUM_HOLDS: usize = 32;

pub type CategoryCounts = [i64; MAX_CATEGORIES];

/// Outcome counts for each of the 32 holds of one dealt hand.
/// Hold mask bit i keeps `hand[i]` (in the order the hand was given).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HoldCounts {
    pub ncat: usize,
    pub counts: [CategoryCounts; NUM_HOLDS],
    /// Number of equally likely draws for each hold: C(deck−5, 5−|hold|).
    pub draws: [i64; NUM_HOLDS],
}

/// Exact EV for each hold, as `numer[m] / draws[m]` credits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HoldEvs {
    pub numer: [i64; NUM_HOLDS],
    pub draws: [i64; NUM_HOLDS],
}

impl HoldCounts {
    pub fn evs(&self, pays: &[i64]) -> HoldEvs {
        let mut numer = [0i64; NUM_HOLDS];
        for m in 0..NUM_HOLDS {
            numer[m] = (0..self.ncat).map(|c| self.counts[m][c] * pays[c]).sum();
        }
        HoldEvs {
            numer,
            draws: self.draws,
        }
    }
}

impl HoldEvs {
    pub fn ev(&self, m: usize) -> f64 {
        self.numer[m] as f64 / self.draws[m] as f64
    }

    /// Exact comparison of the EVs of holds a and b.
    pub fn cmp(&self, a: usize, b: usize) -> std::cmp::Ordering {
        (self.numer[a] as i128 * self.draws[b] as i128)
            .cmp(&(self.numer[b] as i128 * self.draws[a] as i128))
    }

    /// Hold with the highest EV. Exact ties go to the lowest mask.
    pub fn best(&self) -> usize {
        let mut best = 0;
        for m in 1..NUM_HOLDS {
            if self.cmp(m, best) == std::cmp::Ordering::Greater {
                best = m;
            }
        }
        best
    }
}

/// Precomputed subset → category-count tables for one game.
pub struct DrawTables {
    n: usize,
    ncat: usize,
    t0: Vec<u32>,
    t1: Vec<u32>,
    t2: Vec<u32>,
    t3: Vec<u16>,
    t4: Vec<u8>,
}

impl DrawTables {
    pub fn build(game: &Game) -> DrawTables {
        let n = game.deck().size();
        let ncat = game.num_categories();
        assert!(
            n >= 10 && n - 4 <= 255,
            "deck size unsupported by count widths"
        );
        let mut t0 = vec![0u32; ncat];
        let mut t1 = vec![0u32; choose(n, 1) as usize * ncat];
        let mut t2 = vec![0u32; choose(n, 2) as usize * ncat];
        let mut t3 = vec![0u16; choose(n, 3) as usize * ncat];
        let mut t4 = vec![0u8; choose(n, 4) as usize * ncat];
        let all: Vec<u8> = (0..n as u8).collect();

        for_each_combination(&all, 5, |h| {
            let cat = game.category(h);
            t0[cat] += 1;
            let b1 = |i: usize| BINOM[h[i] as usize][1] as usize;
            let b2 = |i: usize| BINOM[h[i] as usize][2] as usize;
            let b3 = |i: usize| BINOM[h[i] as usize][3] as usize;
            let b4 = |i: usize| BINOM[h[i] as usize][4] as usize;
            for i in 0..5 {
                t1[b1(i) * ncat + cat] += 1;
            }
            for i in 0..5 {
                for j in i + 1..5 {
                    t2[(b1(i) + b2(j)) * ncat + cat] += 1;
                    for k in j + 1..5 {
                        t3[(b1(i) + b2(j) + b3(k)) * ncat + cat] += 1;
                        for l in k + 1..5 {
                            t4[(b1(i) + b2(j) + b3(k) + b4(l)) * ncat + cat] += 1;
                        }
                    }
                }
            }
        });
        DrawTables {
            n,
            ncat,
            t0,
            t1,
            t2,
            t3,
            t4,
        }
    }

    pub fn deck_size(&self) -> usize {
        self.n
    }

    /// Approximate memory held by the tables, in bytes.
    pub fn memory_bytes(&self) -> usize {
        4 * (self.t0.len() + self.t1.len() + self.t2.len()) + 2 * self.t3.len() + self.t4.len()
    }

    /// Outcome counts for all 32 holds. `hand` must hold 5 distinct valid cards.
    pub fn hold_counts(&self, game: &Game, hand: &[Card; 5]) -> HoldCounts {
        let ncat = self.ncat;
        // Sort card positions by card id; work in "sorted mask" space.
        let mut order = [0usize, 1, 2, 3, 4];
        order.sort_unstable_by_key(|&i| hand[i]);
        let s: [usize; 5] = order.map(|i| hand[i] as usize);

        let mut g = [[0i64; MAX_CATEGORIES]; NUM_HOLDS];
        for m in 0..NUM_HOLDS {
            let mut idx = 0usize;
            let mut k = 0usize;
            for (j, &card) in s.iter().enumerate() {
                if (m >> j) & 1 == 1 {
                    k += 1;
                    idx += BINOM[card][k] as usize;
                }
            }
            let row = &mut g[m];
            match k {
                0 => self
                    .t0
                    .iter()
                    .zip(row.iter_mut())
                    .for_each(|(&a, r)| *r = a as i64),
                1 => copy_row(&self.t1[idx * ncat..(idx + 1) * ncat], row),
                2 => copy_row(&self.t2[idx * ncat..(idx + 1) * ncat], row),
                3 => copy_row(&self.t3[idx * ncat..(idx + 1) * ncat], row),
                4 => copy_row(&self.t4[idx * ncat..(idx + 1) * ncat], row),
                _ => row[game.category(hand)] = 1,
            }
        }
        // Superset Möbius transform: g[S] ← Σ_{U⊇S} (−1)^{|U∖S|} g[U].
        for bit in 0..5 {
            let b = 1 << bit;
            for m in 0..NUM_HOLDS {
                if m & b == 0 {
                    for c in 0..ncat {
                        g[m][c] -= g[m | b][c];
                    }
                }
            }
        }
        // Translate sorted-mask space back to the caller's card order.
        let mut out = HoldCounts {
            ncat,
            counts: [[0; MAX_CATEGORIES]; NUM_HOLDS],
            draws: [0; NUM_HOLDS],
        };
        let rest = self.n - 5;
        for m in 0..NUM_HOLDS {
            let mut om = 0;
            for (j, &pos) in order.iter().enumerate() {
                if (m >> j) & 1 == 1 {
                    om |= 1 << pos;
                }
            }
            out.counts[om] = g[m];
            out.draws[om] = choose(rest, 5 - (m as u32).count_ones() as usize) as i64;
        }
        out
    }
}

#[inline]
fn copy_row<T: Copy + Into<i64>>(src: &[T], dst: &mut CategoryCounts) {
    for (d, &s) in dst.iter_mut().zip(src) {
        *d = s.into();
    }
}

/// Reference implementation: enumerate every draw for every hold and
/// classify each final hand directly. Independent of `DrawTables`.
pub fn brute_force_hold_counts(game: &Game, hand: &[Card; 5]) -> HoldCounts {
    let n = game.deck().size();
    let ncat = game.num_categories();
    let rest: Vec<u8> = (0..n as u8).filter(|c| !hand.contains(c)).collect();
    let mut out = HoldCounts {
        ncat,
        counts: [[0; MAX_CATEGORIES]; NUM_HOLDS],
        draws: [0; NUM_HOLDS],
    };
    for m in 0..NUM_HOLDS {
        let held: Vec<u8> = (0..5)
            .filter(|&i| (m >> i) & 1 == 1)
            .map(|i| hand[i])
            .collect();
        let need = 5 - held.len();
        let mut fin = [0u8; 5];
        fin[..held.len()].copy_from_slice(&held);
        let mut draws = 0i64;
        for_each_combination(&rest, need, |d| {
            fin[held.len()..].copy_from_slice(d);
            out.counts[m][game.category(&fin)] += 1;
            draws += 1;
        });
        out.draws[m] = draws;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::{builtin_game, builtin_paytable};

    #[test]
    fn royal_hold_all_and_known_hand() {
        let g = builtin_game("jacks-or-better").unwrap();
        let t = builtin_paytable("jacks-or-better-9-6").unwrap();
        let pays = g.pays_for_bet(&t, 5).unwrap();
        let tables = DrawTables::build(&g);
        let d = g.deck();
        let h = d.parse_hand("As Ks Qs Js Ts").unwrap();
        let evs = tables.hold_counts(&g, &h).evs(&pays);
        assert_eq!(evs.best(), 31);
        assert_eq!(evs.ev(31), 4000.0);
        // Same hand in a different order gives the same best hold (all five).
        let h2 = d.parse_hand("Ts Qs As Js Ks").unwrap();
        assert_eq!(tables.hold_counts(&g, &h2).evs(&pays).best(), 31);
        // Matches brute force on a mixed hand.
        let h3 = d.parse_hand("Jh Th 9h 2c 2d").unwrap();
        assert_eq!(
            tables.hold_counts(&g, &h3),
            brute_force_hold_counts(&g, &h3)
        );
    }
}
