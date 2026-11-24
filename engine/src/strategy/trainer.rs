//! Trainer checks for one dealt hand (SPEC §5): the strategy's play, exact
//! EV ties, and the rule distance of every possible hold.
//!
//! Rule distance (§5.3): list the rules that match the dealt hand, in rank
//! order. The first one is the strategy's play (distance 0). A hold the
//! player makes is described by the first rule whose pattern is exactly
//! those cards; its distance is that rule's position in the list. Special
//! cases:
//! - a hold exactly tied in EV with the strategy's hold is the same play
//!   (distance 0, §5.1);
//! - a hold the deciding rule describes but did not choose (e.g. the wrong
//!   two high cards) counts as distance 1: right rule, wrong cards;
//! - a hold no rule describes is off-strategy (`None`).

use super::features::{RuleHit, apply_rule, high_min, rule_matches, subset_features};
use super::rule::Strategy;
use crate::cards::Card;
use crate::draw::HoldEvs;
use crate::game::Game;
use std::cmp::Ordering;

#[derive(Clone, Debug)]
pub struct DealCheck {
    pub evs: HoldEvs,
    /// Highest-EV hold (exact ties go to the lowest mask).
    pub best: u8,
    /// `tie[m]` is the lowest mask whose EV equals hold m's exactly, so two
    /// holds are the same play when their `tie` values are equal.
    pub tie: [u8; 32],
    /// Deciding line (see `Strategy::lines`), or None if the strategy is
    /// incomplete for this hand.
    pub rule: Option<usize>,
    /// The strategy's hold.
    pub hold: u8,
    /// Every line that matches the hand, in rank order, with the hold it
    /// would choose.
    pub matching: Vec<(usize, u8)>,
    /// For each entry of `matching`, the rule on that line that matched
    /// (the first one). `matching_rules[0]` decided the hand.
    pub matching_rules: Vec<usize>,
    /// Rule (not line) that first describes each hold exactly.
    pub describes_rule: [Option<usize>; 32],
    /// First line that describes each hold exactly.
    pub describes: [Option<usize>; 32],
    /// Rule distance of each hold; None = off-strategy.
    pub distance: [Option<u32>; 32],
}

impl DealCheck {
    /// Do holds a and b have exactly equal EV?
    pub fn same_play(&self, a: u8, b: u8) -> bool {
        self.tie[a as usize] == self.tie[b as usize]
    }
}

pub fn deal_check(game: &Game, strategy: &Strategy, hand: &[Card; 5], evs: HoldEvs) -> DealCheck {
    let feats = subset_features(game, hand, high_min(game));
    // Everything here counts written lines: rules joined on one line are one
    // step of rule distance, and a line matches if any of its rules does
    // (with the hold of the first that does).
    let line_of = strategy.line_of();
    let mut matching: Vec<(usize, u8)> = Vec::new();
    let mut matching_rules: Vec<usize> = Vec::new();
    for (i, r) in strategy.rules.iter().enumerate() {
        if let RuleHit::Hold { mask, .. } = apply_rule(r, &feats) {
            if matching.last().is_none_or(|&(l, _)| l != line_of[i]) {
                matching.push((line_of[i], mask));
                matching_rules.push(i);
            }
        }
    }
    let (rule, hold) = match matching.first() {
        Some(&(i, m)) => (Some(i), m),
        None => (None, 0),
    };

    let mut describes = [None; 32];
    let mut describes_rule = [None; 32];
    for f in feats.iter() {
        let i = strategy.rules.iter().position(|r| rule_matches(r, f));
        describes_rule[f.mask as usize] = i;
        describes[f.mask as usize] = i.map(|i| line_of[i]);
    }

    let mut tie = [0u8; 32];
    for m in 0..32 {
        tie[m] = (0..=m).find(|&o| evs.cmp(m, o) == Ordering::Equal).unwrap() as u8;
    }

    let mut distance = [None; 32];
    for m in 0..32u8 {
        distance[m as usize] = if tie[m as usize] == tie[hold as usize] {
            Some(0)
        } else {
            describes[m as usize].map(|r| {
                // Every rule describing a subset matches the hand, so it is
                // in `matching`.
                let pos = matching.iter().position(|&(i, _)| i == r).unwrap() as u32;
                pos.max(1)
            })
        };
    }

    DealCheck {
        best: evs.best() as u8,
        evs,
        tie,
        rule,
        hold,
        matching,
        matching_rules,
        describes,
        describes_rule,
        distance,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::Analyzer;
    use crate::game::{builtin_game, builtin_paytable};

    const SIMPLE: &str = "\
royal flush, straight flush, four of a kind, full house
4 to a royal
flush, straight
three of a kind
two pair
pair J-A
4 to a straight flush
4 to a flush
pair
4 to a straight w=2
3 to a royal
2 high cards suited
2 high cards prefer low
1 high card prefer low
discard everything
";

    struct Fx {
        an: Analyzer,
        pays: Vec<i64>,
        s: Strategy,
    }
    fn fx() -> Fx {
        let g = builtin_game("jacks-or-better").unwrap();
        let t = builtin_paytable("jacks-or-better-9-6").unwrap();
        let pays = g.pays_for_bet(&t, 5).unwrap();
        Fx {
            an: Analyzer::new(g),
            pays,
            s: Strategy::parse(SIMPLE).unwrap(),
        }
    }
    impl Fx {
        fn check(&self, hand: &str) -> (DealCheck, [Card; 5]) {
            let h = self.an.game.deck().parse_hand(hand).unwrap();
            let evs = self.an.hold_evs(&h, &self.pays);
            (deal_check(&self.an.game, &self.s, &h, evs), h)
        }
        fn mask(&self, h: &[Card; 5], cards: &str) -> u8 {
            let d = self.an.game.deck();
            let mut m = 0;
            for name in cards.split_whitespace() {
                let c = d.parse_card(name).unwrap();
                m |= 1 << h.iter().position(|&x| x == c).unwrap();
            }
            m
        }
    }

    #[test]
    fn distances_follow_the_matching_list() {
        let f = fx();
        let (c, h) = f.check("Ah Kh 7c 7d 2s");
        // pair(8), 2 high suited(11), 2 high(12), 1 high(13), discard(14)
        assert_eq!(
            c.matching.iter().map(|m| m.0).collect::<Vec<_>>(),
            vec![8, 11, 12, 13, 14]
        );
        assert_eq!(c.rule, Some(8));
        assert_eq!(c.hold, f.mask(&h, "7c 7d"));
        assert_eq!(c.distance[f.mask(&h, "7c 7d") as usize], Some(0));
        assert_eq!(c.distance[f.mask(&h, "Ah Kh") as usize], Some(1)); // next rule: yellow
        assert_eq!(c.distance[f.mask(&h, "Ah") as usize], Some(3));
        assert_eq!(c.distance[0], Some(4)); // discard everything
        assert_eq!(c.distance[f.mask(&h, "7c 7d Ah") as usize], None); // off-strategy
        assert_eq!(c.distance[f.mask(&h, "Kh 2s") as usize], None);
    }

    #[test]
    fn right_rule_wrong_cards_is_one_away() {
        let f = fx();
        let (c, h) = f.check("Kh Qs Jd 5c 3h");
        let qj = f.mask(&h, "Qs Jd");
        let kq = f.mask(&h, "Kh Qs");
        assert_eq!(c.rule, Some(12));
        assert_eq!(c.hold, qj);
        assert!(!c.same_play(qj, kq));
        assert_eq!(c.describes[kq as usize], Some(12));
        assert_eq!(c.distance[kq as usize], Some(1));
    }

    #[test]
    fn exact_ev_ties_are_the_same_play() {
        let f = fx();
        let (c, h) = f.check("Qh Qd 9c 6s 3c");
        for m in 0..32 {
            for o in 0..32 {
                assert_eq!(
                    c.same_play(m, o),
                    c.evs.cmp(m as usize, o as usize) == Ordering::Equal
                );
            }
        }
        assert_eq!(c.distance[f.mask(&h, "Qh Qd") as usize], Some(0));
        // Suit-symmetric holds are exactly tied: 2c alone vs 2d alone.
        let (c, h) = f.check("2c 2d 7h 9s Js");
        assert!(c.same_play(f.mask(&h, "2c"), f.mask(&h, "2d")));
        assert!(c.same_play(f.mask(&h, "2c 7h"), f.mask(&h, "2d 7h")));
        assert!(!c.same_play(f.mask(&h, "2c"), f.mask(&h, "7h")));
        // A lower rule's hold is one away even when the hand has a pair.
        let (c, h) = f.check("2c 5c 8c Jc 2d");
        // Strategy: 4 to a flush (rule 7) beats a low pair (8).
        assert_eq!(c.rule, Some(7));
        assert_eq!(c.hold, f.mask(&h, "2c 5c 8c Jc"));
        assert_eq!(c.distance[f.mask(&h, "2c 2d") as usize], Some(1));
    }

    #[test]
    fn invariants_on_random_hands() {
        let f = fx();
        let mut rng = crate::verify::Rng::new(77);
        for _ in 0..3000 {
            let h = rng.hand(f.an.game.deck());
            let evs = f.an.hold_evs(&h, &f.pays);
            let c = deal_check(&f.an.game, &f.s, &h, evs.clone());
            let p = super::super::play(&f.an.game, &f.s, &h);
            assert_eq!(c.rule, p.rule);
            assert_eq!(c.hold, p.hold);
            assert_eq!(c.distance[c.hold as usize], Some(0));
            assert_eq!(c.best as usize, evs.best());
            for m in 0..32u8 {
                let d = c.distance[m as usize];
                if c.same_play(m, c.hold) {
                    assert_eq!(d, Some(0));
                } else {
                    assert_eq!(d.is_some(), c.describes[m as usize].is_some());
                    assert_ne!(d, Some(0));
                    if let Some(d) = d {
                        assert!((d as usize) < c.matching.len());
                    }
                }
                // Each rule describing a hold must be a matching rule.
                if let Some(r) = c.describes[m as usize] {
                    assert!(c.matching.iter().any(|&(i, _)| i == r));
                }
            }
        }
    }
}
