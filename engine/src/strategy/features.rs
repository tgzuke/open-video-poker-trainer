//! Features of each of the 32 subsets of a dealt hand, and rule matching.

use super::rule::{Family, Pattern, Rule};
use crate::cards::Card;
use crate::eval::HandKind;
use crate::game::Game;

/// The ten five-rank straight windows (A-5 … T-A) as rank bitmasks.
pub const WINDOWS: [u16; 10] = {
    let mut w = [0u16; 10];
    w[0] = (1 << 14) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);
    let mut i = 1;
    while i < 10 {
        let lo = i + 1; // 2..=10
        w[i] = 0b11111 << lo;
        i += 1;
    }
    w
};

/// Number of straight windows containing every rank in `mask`.
#[inline]
pub fn windows(mask: u16) -> u8 {
    WINDOWS.iter().filter(|&&w| w & mask == mask).count() as u8
}

/// Union of all windows containing `mask` (ranks that could join a straight).
#[inline]
pub fn window_union(mask: u16) -> u16 {
    WINDOWS
        .iter()
        .filter(|&&w| w & mask == mask)
        .fold(0, |a, &w| a | w)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Nothing,
    Made(HandKind),
    Pair(u8),
    TwoPair,
    Trips {
        rank: u8,
        kicker: Option<u8>,
    },
    Quads {
        rank: u8,
        kicker: Option<u8>,
    },
    Distinct {
        family: Option<Family>,
        suited: Option<bool>,
        w: u8,
        h: u8,
    },
    /// A combination no rule describes (e.g. a pair plus kickers).
    Other,
}

#[derive(Clone, Copy, Debug)]
pub struct SubsetFeat {
    pub mask: u8,
    pub n: u8,
    pub shape: Shape,
    /// Held rank set (distinct ranks only; 0 for grouped shapes).
    pub ranks: u16,
    pub fp: u8,
    pub sp: u8,
    /// Held ranks sorted high→low, packed 4 bits each: compares like the
    /// ranks read left to right.
    pub rank_key: u32,
}

/// Lowest rank that pays as a pair in this game (J in all v1 games).
pub fn high_min(game: &Game) -> u8 {
    game.def
        .lines
        .iter()
        .filter(|l| l.hand == HandKind::Pair)
        .filter_map(|l| l.min_rank.as_deref())
        .filter_map(|r| crate::cards::parse_rank(r).ok())
        .min()
        .unwrap_or(11)
}

/// Features of all 32 subsets of `hand` (mask bit i keeps hand[i]).
pub fn subset_features(game: &Game, hand: &[Card; 5], hi: u8) -> [SubsetFeat; 32] {
    let d = game.deck();
    let ranks: [u8; 5] = hand.map(|c| d.rank(c));
    let suits: [u8; 5] = hand.map(|c| d.suit(c));
    let full_kind = game.hand_info(hand).kind;
    // Rank counts in the dealt hand: groups match only as dealt (a pair is a
    // rank dealt exactly twice, never two cards out of trips or quads).
    let mut dealt = [0u8; 15];
    for &r in &ranks {
        dealt[r as usize] += 1;
    }
    std::array::from_fn(|m| {
        let m = m as u8;
        let held: Vec<usize> = (0..5).filter(|&i| m >> i & 1 == 1).collect();
        let n = held.len() as u8;
        let mut counts = [0u8; 15];
        let mut rmask = 0u16;
        for &i in &held {
            counts[ranks[i] as usize] += 1;
            rmask |= 1 << ranks[i];
        }
        let mut sorted: Vec<u8> = held.iter().map(|&i| ranks[i]).collect();
        sorted.sort_unstable_by(|a, b| b.cmp(a));
        let rank_key =
            sorted.iter().fold(0u32, |k, &r| (k << 4) | r as u32) << (4 * (5 - n as u32));
        let distinct = rmask.count_ones() as u8 == n;
        let all_suited = n >= 1 && held.iter().all(|&i| suits[i] == suits[held[0]]);

        let mut fp = 0;
        let mut sp = 0;
        let shape = if n == 0 {
            Shape::Nothing
        } else if n == 5 {
            match full_kind {
                HandKind::RoyalFlush
                | HandKind::StraightFlush
                | HandKind::FullHouse
                | HandKind::Flush
                | HandKind::Straight => Shape::Made(full_kind),
                HandKind::FourOfAKind => {
                    let q = (2..=14u8).find(|&r| counts[r as usize] == 4).unwrap();
                    let k = (2..=14u8).find(|&r| counts[r as usize] == 1).unwrap();
                    Shape::Quads {
                        rank: q,
                        kicker: Some(k),
                    }
                }
                _ => Shape::Other,
            }
        } else if distinct {
            let suited = if n >= 2 { Some(all_suited) } else { None };
            let w = windows(rmask);
            let h = sorted.iter().filter(|&&r| r >= hi).count() as u8;
            let family = match suited {
                Some(true) if sorted.iter().all(|&r| r >= 10) => Some(Family::Royal),
                Some(true) if w >= 1 => Some(Family::StraightFlush),
                Some(true) => Some(Family::Flush),
                Some(false) if w >= 1 => Some(Family::Straight),
                _ => None,
            };
            let discards = (0..5).filter(|&i| m >> i & 1 == 0);
            if all_suited {
                fp = discards
                    .clone()
                    .filter(|&i| suits[i] == suits[held[0]])
                    .count() as u8;
            }
            if w >= 1 {
                let u = window_union(rmask);
                sp = discards
                    .filter(|&i| rmask & (1 << ranks[i]) == 0 && u & (1 << ranks[i]) != 0)
                    .filter(|&i| windows(rmask | (1 << ranks[i])) >= 1)
                    .count() as u8;
            }
            Shape::Distinct {
                family,
                suited,
                w,
                h,
            }
        } else {
            let mut groups: Vec<(u8, u8)> = (2..=14u8)
                .filter(|&r| counts[r as usize] > 0)
                .map(|r| (counts[r as usize], r))
                .collect();
            groups.sort_unstable_by(|a, b| b.cmp(a));
            let natural = |c: u8, r: u8| dealt[r as usize] == c;
            match groups.as_slice() {
                [(2, r)] if natural(2, *r) => Shape::Pair(*r),
                [(2, a), (2, b)] if natural(2, *a) && natural(2, *b) => Shape::TwoPair,
                [(3, r)] if natural(3, *r) => Shape::Trips {
                    rank: *r,
                    kicker: None,
                },
                [(3, r), (1, k)] if natural(3, *r) => Shape::Trips {
                    rank: *r,
                    kicker: Some(*k),
                },
                [(4, r)] => Shape::Quads {
                    rank: *r,
                    kicker: None,
                },
                _ => Shape::Other,
            }
        };
        SubsetFeat {
            mask: m,
            n,
            shape,
            ranks: if distinct { rmask } else { 0 },
            fp,
            sp,
            rank_key,
        }
    })
}

#[inline]
fn in_set(set: u16, r: u8) -> bool {
    set & (1 << r) != 0
}

/// Does `rule` describe this held subset (including qualifiers)?
pub fn rule_matches(rule: &Rule, f: &SubsetFeat) -> bool {
    let shape_ok = match (rule.pattern, f.shape) {
        (Pattern::Nothing, Shape::Nothing) => true,
        (Pattern::Made(k), Shape::Made(k2)) => k == k2,
        (Pattern::Pat(m), Shape::Made(k)) => {
            super::rule::pat_bit(k).is_some_and(|b| m >> b & 1 == 1)
        }
        (Pattern::Pat(m), Shape::Quads { kicker: None, .. }) => m >> 2 & 1 == 1,
        (Pattern::Pair { ranks }, Shape::Pair(r)) => in_set(ranks, r),
        (Pattern::TwoPair, Shape::TwoPair) => true,
        (Pattern::Trips { ranks, kicker }, Shape::Trips { rank, kicker: k }) => {
            in_set(ranks, rank)
                && match (kicker, k) {
                    (None, None) => true,
                    (Some(set), Some(k)) => in_set(set, k),
                    _ => false,
                }
        }
        (Pattern::Quads { ranks, kicker }, Shape::Quads { rank, kicker: k }) => {
            in_set(ranks, rank)
                && match (kicker, k) {
                    (None, None) => true,
                    (Some(set), Some(k)) => in_set(set, k),
                    _ => false,
                }
        }
        (
            Pattern::Draw { family, n, w, h },
            Shape::Distinct {
                family: Some(fam),
                w: fw,
                h: fh,
                ..
            },
        ) => family == fam && n == f.n && w.is_none_or(|w| w == fw) && h.is_none_or(|h| h == fh),
        (Pattern::Exact { ranks, suited }, Shape::Distinct { suited: s, .. }) => {
            ranks == f.ranks && suited == s
        }
        (Pattern::High { n, suited }, Shape::Distinct { suited: s, h, .. }) => {
            n == f.n && h == n && suited.is_none_or(|x| s == Some(x))
        }
        _ => false,
    };
    shape_ok && rule.fp.is_none_or(|c| c.test(f.fp)) && rule.sp.is_none_or(|c| c.test(f.sp))
}

/// Outcome of applying one rule to a hand.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RuleHit {
    NoMatch,
    /// The rule's chosen hold, plus any other subsets left tied by the
    /// tie-break (suit-swapped equivalents to check for EV equality).
    Hold {
        mask: u8,
        alternatives: Vec<u8>,
    },
}

/// Applies the tie-break to every subset `rule` matches.
pub fn apply_rule(rule: &Rule, feats: &[SubsetFeat; 32]) -> RuleHit {
    let mut best: Option<&SubsetFeat> = None;
    let mut alts: Vec<u8> = Vec::new();
    // Ordering key: ranks (high or low first), then fewer fp, then fewer sp.
    let key = |f: &SubsetFeat| {
        let rk = if rule.prefer_low {
            u32::MAX - f.rank_key
        } else {
            f.rank_key
        };
        (rk, u8::MAX - f.fp, u8::MAX - f.sp)
    };
    for f in feats.iter().filter(|f| rule_matches(rule, f)) {
        match best {
            None => best = Some(f),
            Some(b) => match key(f).cmp(&key(b)) {
                std::cmp::Ordering::Greater => {
                    best = Some(f);
                    alts.clear();
                }
                std::cmp::Ordering::Equal => alts.push(f.mask),
                std::cmp::Ordering::Less => {}
            },
        }
    }
    match best {
        None => RuleHit::NoMatch,
        Some(b) => RuleHit::Hold {
            mask: b.mask,
            alternatives: alts,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::builtin_game;
    use crate::strategy::rule::Rule;

    fn hold(rule: &str, hand: &str) -> Option<String> {
        let g = builtin_game("double-double-bonus").unwrap();
        let d = g.deck();
        let h = d.parse_hand(hand).unwrap();
        let feats = subset_features(&g, &h, high_min(&g));
        match apply_rule(&rule.parse::<Rule>().unwrap(), &feats) {
            RuleHit::NoMatch => None,
            RuleHit::Hold { mask, .. } => Some(
                (0..5)
                    .filter(|i| mask >> i & 1 == 1)
                    .map(|i| d.card_name(h[i]))
                    .collect::<Vec<_>>()
                    .join(" "),
            ),
        }
    }

    #[test]
    fn windows_count() {
        assert_eq!(windows(0), 10);
        let m = |rs: &[u8]| rs.iter().fold(0u16, |a, &r| a | 1 << r);
        assert_eq!(windows(m(&[12, 11])), 3); // QJ
        assert_eq!(windows(m(&[14, 13])), 1); // AK
        assert_eq!(windows(m(&[14, 2])), 1); // A2 (wheel)
        assert_eq!(windows(m(&[9, 8, 7, 6])), 2); // open-ended
        assert_eq!(windows(m(&[9, 8, 6, 5])), 1); // inside
        assert_eq!(windows(m(&[14, 9])), 0);
    }

    #[test]
    fn rule_semantics() {
        assert_eq!(
            hold("4 to a royal", "As Ks Qs Js 2d").as_deref(),
            Some("As Ks Qs Js")
        );
        // 4 to a royal is not also "4 to a straight flush".
        assert_eq!(hold("4 to a straight flush", "As Ks Qs Js 2d"), None);
        assert_eq!(
            hold("4 to a straight flush w=2", "9s 8s 7s 6s Ad").as_deref(),
            Some("9s 8s 7s 6s")
        );
        assert_eq!(
            hold("4 to a straight w=2 h=0", "9s 8d 7s 6s Ad").as_deref(),
            Some("9s 8d 7s 6s")
        );
        assert_eq!(
            hold("4 to a straight w=1 h=4", "As Kd Qs Jc 2d").as_deref(),
            Some("As Kd Qs Jc")
        );
        assert_eq!(hold("pair J-A", "Js Jd Qs 2c 2d").as_deref(), Some("Js Jd"));
        assert_eq!(hold("pair 2-T", "Js Jd Qs 2c 2d").as_deref(), Some("2c 2d"));
        assert_eq!(
            hold("two pair", "Js Jd Qs 2c 2d").as_deref(),
            Some("Js Jd 2c 2d")
        );
        assert_eq!(
            hold("three of a kind A kicker 2-4", "As Ad Ac 3c 9d").as_deref(),
            Some("As Ad Ac 3c")
        );
        assert_eq!(hold("three of a kind A kicker 2-4", "As Ad Ac 5c 9d"), None);
        assert_eq!(
            hold("four of a kind 2-4 kicker A,2-4", "3s 3d 3c 3h Ad").as_deref(),
            Some("3s 3d 3c 3h Ad")
        );
        assert_eq!(
            hold("four of a kind", "3s 3d 3c 3h Ad").as_deref(),
            Some("3s 3d 3c 3h")
        );
        assert_eq!(
            hold("full house", "3s 3d 3c Ah Ad").as_deref(),
            Some("3s 3d 3c Ah Ad")
        );
        assert_eq!(
            hold("three of a kind", "3s 3d 3c Ah Ad").as_deref(),
            Some("3s 3d 3c")
        );
        assert_eq!(hold("pair", "3s 3d 3c Ah Ad").as_deref(), Some("Ah Ad"));
        // Groups match only as dealt: no trips out of quads, no pair out of trips.
        assert_eq!(hold("three of a kind", "3s 3d 3c 3h Ad"), None);
        assert_eq!(hold("pair", "3s 3d 3c 7h Ad"), None);
        assert_eq!(hold("two pair", "3s 3d 3c 3h Ad"), None);
        assert_eq!(
            hold("QJ suited", "Qh Jh Qs 2c 3d").as_deref(),
            Some("Qh Jh")
        );
        assert_eq!(
            hold("QJ unsuited", "Qh Jh Qs 2c 3d").as_deref(),
            Some("Jh Qs") // held cards print in dealt order
        );
        // Tie-break: highest ranks first; "prefer low" reverses.
        assert_eq!(hold("K", "Ks Kd 2c 3d 7h").as_deref(), Some("Ks")); // then fewer fp/sp
        assert_eq!(
            hold("3 to a flush", "Ks 9s 2s 4s 7h").as_deref(),
            Some("Ks 9s 4s")
        );
        assert_eq!(
            hold("3 to a flush prefer low", "Ks 9s 2s 4s 7h").as_deref(),
            Some("9s 2s 4s")
        );
        assert_eq!(hold("1 high card", "Ks Jd 2c 3d 7h").as_deref(), Some("Ks"));
        assert_eq!(
            hold("1 high card prefer low", "Ks Jd 2c 3d 7h").as_deref(),
            Some("Jd")
        );
        assert_eq!(hold("2 high cards suited", "Ks Jd 2c 3d 7h"), None);
        assert_eq!(
            hold("2 high cards", "Ks Jd 2c 3d 7h").as_deref(),
            Some("Ks Jd")
        );
        assert_eq!(
            hold("royal flush, four of a kind", "3s 3d 3c 3h Ad").as_deref(),
            Some("3s 3d 3c 3h")
        );
        assert_eq!(
            hold("flush, straight", "9s Td Jc Qh Kd").as_deref(),
            Some("9s Td Jc Qh Kd")
        );
        assert_eq!(hold("flush, straight", "9s Ts Js Qs Ks"), None); // a straight flush
        assert_eq!(
            hold("discard everything", "Ks 9s 2s 4s 7h").as_deref(),
            Some("")
        );
    }

    #[test]
    fn penalties() {
        let g = builtin_game("jacks-or-better").unwrap();
        let d = g.deck();
        let h = d.parse_hand("Qh Jh 9h 2c 3d").unwrap();
        let f = subset_features(&g, &h, high_min(&g));
        let qj = f[0b00011];
        assert_eq!(qj.fp, 1); // 9h discarded
        assert_eq!(qj.sp, 1); // 9 fits a straight with QJ
        assert!(rule_matches(&"QJ suited fp>=1".parse().unwrap(), &qj));
        assert!(!rule_matches(&"QJ suited fp=0".parse().unwrap(), &qj));
        let h = d.parse_hand("Kc Qd 2h 3s Ts").unwrap();
        let kq = subset_features(&g, &h, high_min(&g))[0b00011];
        assert_eq!((kq.fp, kq.sp), (0, 1)); // unsuited: no fp; T fits K-Q
    }
}
