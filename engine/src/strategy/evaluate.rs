//! Exact strategy evaluation (SPEC §4.2) and completeness check (§4.1).

use super::features::{RuleHit, SubsetFeat, apply_rule, high_min, subset_features};
use super::rule::Strategy;
use crate::analysis::{Analyzer, Ratio};
use crate::cards::Card;
use crate::draw::HoldEvs;
use crate::game::Game;
use std::cmp::Ordering;

/// What a strategy does with one hand.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Play {
    /// Index of the rule that decided, or None if no rule matched.
    pub rule: Option<usize>,
    pub hold: u8,
    /// Other holds the rule left tied after its tie-break.
    pub alternatives: Vec<u8>,
}

/// Plays a hand by the strategy: the first rule matching any subset decides.
pub fn play_features(strategy: &Strategy, feats: &[SubsetFeat; 32]) -> Play {
    for (i, rule) in strategy.rules.iter().enumerate() {
        if let RuleHit::Hold { mask, alternatives } = apply_rule(rule, feats) {
            return Play {
                rule: Some(i),
                hold: mask,
                alternatives,
            };
        }
    }
    Play {
        rule: None,
        hold: 0,
        alternatives: vec![],
    }
}

pub fn play(game: &Game, strategy: &Strategy, hand: &[Card; 5]) -> Play {
    play_features(strategy, &subset_features(game, hand, high_min(game)))
}

/// Every rule that matches the hand, in strategy order (for rule distance).
pub fn matching_rules(game: &Game, strategy: &Strategy, hand: &[Card; 5]) -> Vec<(usize, u8)> {
    let feats = subset_features(game, hand, high_min(game));
    strategy
        .rules
        .iter()
        .enumerate()
        .filter_map(|(i, r)| match apply_rule(r, &feats) {
            RuleHit::Hold { mask, .. } => Some((i, mask)),
            RuleHit::NoMatch => None,
        })
        .collect()
}

/// All holds whose EV equals the best exactly (SPEC §3.1: equivalent).
pub fn optimal_set(evs: &HoldEvs) -> u32 {
    let best = evs.best();
    (0..32)
        .filter(|&m| evs.cmp(m, best) == Ordering::Equal)
        .fold(0, |a, m| a | 1 << m)
}

#[derive(Clone, Debug, Default)]
pub struct RuleStats {
    /// Probability that this rule decides the hand.
    pub fires: f64,
    /// Probability that it decides and its hold is not optimal.
    pub disagrees: f64,
    /// EV given up on those hands, in credits per hand dealt.
    pub loss: f64,
}

#[derive(Clone, Debug)]
pub struct Problem {
    pub hand: String,
    pub rule: Option<usize>,
    /// Weight (deals) of the hand's suit class.
    pub weight: u32,
}

#[derive(Clone, Debug)]
pub struct Report {
    pub ret: Ratio,
    pub optimal: Ratio,
    pub bet: u32,
    pub rules: Vec<RuleStats>,
    /// Hands no rule matches.
    pub undefined: Vec<Problem>,
    /// Hands where a rule leaves holds of different EV tied.
    pub ambiguous: Vec<Problem>,
    /// Chosen hold per class (for exact cross-checks).
    pub holds: Vec<u8>,
    /// Costliest misplays: (credits/hand lost, hand, rule index, strategy
    /// hold, optimal hold), worst first, at most 25.
    pub worst: Vec<(f64, String, usize, u8, u8)>,
}

impl Report {
    /// EV loss against optimal play, credits per hand.
    pub fn loss_credits(&self) -> f64 {
        (self.optimal.to_f64() - self.ret.to_f64()) * self.bet as f64
    }
    /// EV loss in percentage points of return.
    pub fn loss_points(&self) -> f64 {
        (self.optimal.to_f64() - self.ret.to_f64()) * 100.0
    }
    pub fn is_complete(&self) -> bool {
        self.undefined.is_empty() && self.ambiguous.is_empty()
    }
}

pub fn evaluate(an: &Analyzer, pays: &[i64], bet: u32, strategy: &Strategy) -> Report {
    let game = &an.game;
    let hi = high_min(game);
    let deals: f64 = an.classes.iter().map(|c| c.weight as f64).sum();
    let mut rules = vec![RuleStats::default(); strategy.rules.len()];
    let mut holds = Vec::with_capacity(an.classes.len());
    let mut best_holds = Vec::with_capacity(an.classes.len());
    let (mut undefined, mut ambiguous) = (vec![], vec![]);
    let mut worst: Vec<(f64, usize, usize, u8, u8)> = vec![];
    for cl in &an.classes {
        let evs = an.hold_evs(&cl.cards, pays);
        let best = evs.best();
        best_holds.push(best as u8);
        let feats = subset_features(game, &cl.cards, hi);
        let p = play_features(strategy, &feats);
        let problem = || Problem {
            hand: game.deck().hand_name(&cl.cards),
            rule: p.rule,
            weight: cl.weight,
        };
        match p.rule {
            None => undefined.push(problem()),
            Some(i) => {
                if p.alternatives
                    .iter()
                    .any(|&a| evs.cmp(a as usize, p.hold as usize) != Ordering::Equal)
                {
                    ambiguous.push(problem());
                }
                let w = cl.weight as f64 / deals;
                let st = &mut rules[i];
                st.fires += w;
                if evs.cmp(p.hold as usize, best) == Ordering::Less {
                    st.disagrees += w;
                    let l = w * (evs.ev(best) - evs.ev(p.hold as usize));
                    st.loss += l;
                    worst.push((l, holds.len(), i, p.hold, best as u8));
                }
            }
        }
        holds.push(p.hold);
    }
    let ret = an.holds_return(pays, bet, &holds).ret;
    let optimal = an.holds_return(pays, bet, &best_holds).ret;
    worst.sort_by(|a, b| b.0.total_cmp(&a.0));
    worst.truncate(25);
    let worst = worst
        .into_iter()
        .map(|(l, c, r, h, b)| (l, game.deck().hand_name(&an.classes[c].cards), r, h, b))
        .collect();
    Report {
        ret,
        optimal,
        bet,
        rules,
        undefined,
        ambiguous,
        holds,
        worst,
    }
}
