//! Five-card hand classification (natural cards, no wilds yet).
//!
//! `classify` reports the poker hand kind plus the ranks a pay line may care
//! about (pair/trips/quad rank, quad kicker). Pay-table matching lives in
//! `game.rs`; this module knows nothing about payouts.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HandKind {
    HighCard,
    Pair,
    TwoPair,
    ThreeOfAKind,
    Straight,
    Flush,
    FullHouse,
    FourOfAKind,
    StraightFlush,
    RoyalFlush,
}

impl HandKind {
    pub const ALL: [HandKind; 10] = [
        HandKind::HighCard,
        HandKind::Pair,
        HandKind::TwoPair,
        HandKind::ThreeOfAKind,
        HandKind::Straight,
        HandKind::Flush,
        HandKind::FullHouse,
        HandKind::FourOfAKind,
        HandKind::StraightFlush,
        HandKind::RoyalFlush,
    ];
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HandInfo {
    pub kind: HandKind,
    /// Rank value of the pair, trips or quads; the higher pair for two pair;
    /// the trips rank for a full house; the high card otherwise
    /// (5 for a wheel straight).
    pub primary: u8,
    /// Four of a kind: rank of the fifth card. Two pair: the lower pair.
    /// Full house: the pair rank. Otherwise 0.
    pub secondary: u8,
}

const WHEEL: u16 = (1 << 14) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);
const ROYAL: u16 = (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13) | (1 << 14);

/// Classifies five natural cards given their rank values (2..=14) and suits.
pub fn classify(ranks: [u8; 5], suits: [u8; 5]) -> HandInfo {
    let flush = suits.iter().all(|&s| s == suits[0]);
    let mut counts = [0u8; 15];
    let mut mask: u16 = 0;
    for &r in &ranks {
        counts[r as usize] += 1;
        mask |= 1 << r;
    }
    let distinct = mask.count_ones();

    if distinct == 5 {
        let high = 15 - mask.leading_zeros() as u8; // highest set bit index
        let low = mask.trailing_zeros() as u8;
        let (straight, top) = if high - low == 4 {
            (true, high)
        } else if mask == WHEEL {
            (true, 5)
        } else {
            (false, high)
        };
        let kind = match (straight, flush) {
            (true, true) if mask == ROYAL => HandKind::RoyalFlush,
            (true, true) => HandKind::StraightFlush,
            (false, true) => HandKind::Flush,
            (true, false) => HandKind::Straight,
            (false, false) => HandKind::HighCard,
        };
        return HandInfo {
            kind,
            primary: top,
            secondary: 0,
        };
    }

    // Paired hands (cannot be flushes or straights with natural cards).
    let mut quad = 0;
    let mut trip = 0;
    let mut pair_hi = 0;
    let mut pair_lo = 0;
    let mut single = 0;
    for r in (2..=14u8).rev() {
        match counts[r as usize] {
            4 => quad = r,
            3 => trip = r,
            2 => {
                if pair_hi == 0 {
                    pair_hi = r
                } else {
                    pair_lo = r
                }
            }
            1 => {
                if single == 0 {
                    single = r
                }
            }
            _ => {}
        }
    }
    if quad != 0 {
        HandInfo {
            kind: HandKind::FourOfAKind,
            primary: quad,
            secondary: single,
        }
    } else if trip != 0 && pair_hi != 0 {
        HandInfo {
            kind: HandKind::FullHouse,
            primary: trip,
            secondary: pair_hi,
        }
    } else if trip != 0 {
        HandInfo {
            kind: HandKind::ThreeOfAKind,
            primary: trip,
            secondary: 0,
        }
    } else if pair_lo != 0 {
        HandInfo {
            kind: HandKind::TwoPair,
            primary: pair_hi,
            secondary: pair_lo,
        }
    } else {
        HandInfo {
            kind: HandKind::Pair,
            primary: pair_hi,
            secondary: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::Deck;
    use crate::combin::for_each_combination;
    use std::collections::HashMap;

    fn info(s: &str) -> HandInfo {
        let d = Deck::standard();
        let h = d.parse_hand(s).unwrap();
        classify(h.map(|c| d.rank(c)), h.map(|c| d.suit(c)))
    }

    #[test]
    fn known_hands() {
        assert_eq!(info("As Ks Qs Js Ts").kind, HandKind::RoyalFlush);
        assert_eq!(info("9s Ks Qs Js Ts").kind, HandKind::StraightFlush);
        let w = info("As 2s 3s 4s 5s");
        assert_eq!((w.kind, w.primary), (HandKind::StraightFlush, 5));
        assert_eq!(info("Ah 2s 3s 4s 5s").kind, HandKind::Straight);
        assert_eq!(info("Ah Ks Qs Js Ts").kind, HandKind::Straight);
        assert_eq!(info("Kh As 2s 3s 4s").kind, HandKind::HighCard); // no wrap-around
        assert_eq!(info("2s 7s 9s Js Ks").kind, HandKind::Flush);
        let q = info("7s 7h 7d 7c Ah");
        assert_eq!(
            (q.kind, q.primary, q.secondary),
            (HandKind::FourOfAKind, 7, 14)
        );
        let fh = info("7s 7h 7d Kc Kh");
        assert_eq!(
            (fh.kind, fh.primary, fh.secondary),
            (HandKind::FullHouse, 7, 13)
        );
        assert_eq!(info("7s 7h 7d Kc 2h").kind, HandKind::ThreeOfAKind);
        let tp = info("7s 7h Kd Kc 2h");
        assert_eq!(
            (tp.kind, tp.primary, tp.secondary),
            (HandKind::TwoPair, 13, 7)
        );
        let p = info("Js Jh 4d 3c 2h");
        assert_eq!((p.kind, p.primary), (HandKind::Pair, 11));
        assert_eq!(info("Js Th 4d 3c 2h").kind, HandKind::HighCard);
    }

    /// Category totals over all C(52,5) hands are combinatorial facts.
    #[test]
    fn full_deck_category_counts() {
        let d = Deck::standard();
        let cards: Vec<u8> = (0..52).collect();
        let mut tally: HashMap<HandKind, u64> = HashMap::new();
        for_each_combination(&cards, 5, |h| {
            let r = [
                d.rank(h[0]),
                d.rank(h[1]),
                d.rank(h[2]),
                d.rank(h[3]),
                d.rank(h[4]),
            ];
            let s = [
                d.suit(h[0]),
                d.suit(h[1]),
                d.suit(h[2]),
                d.suit(h[3]),
                d.suit(h[4]),
            ];
            *tally.entry(classify(r, s).kind).or_default() += 1;
        });
        let expect = [
            (HandKind::RoyalFlush, 4),
            (HandKind::StraightFlush, 36),
            (HandKind::FourOfAKind, 624),
            (HandKind::FullHouse, 3_744),
            (HandKind::Flush, 5_108),
            (HandKind::Straight, 10_200),
            (HandKind::ThreeOfAKind, 54_912),
            (HandKind::TwoPair, 123_552),
            (HandKind::Pair, 1_098_240),
            (HandKind::HighCard, 1_302_540),
        ];
        for (k, n) in expect {
            assert_eq!(tally.get(&k).copied().unwrap_or(0), n, "{k:?}");
        }
    }
}
