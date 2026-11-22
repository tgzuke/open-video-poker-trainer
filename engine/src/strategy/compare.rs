//! Pay table comparison (SPEC §4.5): how strategy B (for pay table B)
//! differs from strategy A (for pay table A), and what each difference is
//! worth when playing table B.
//!
//! Combined pat-hand lines ("full house, flush") are first split into one
//! line per hand (same play), so a reworded pat line is not a change. Rules
//! are then matched exactly. Rules in A but not in B are *removed*,
//! rules in B but not in A are *added*, and common rules outside the longest
//! common subsequence of the two lists are *moved*.
//!
//! The changes are applied one at a time to A's list, top-down, until it is
//! B's list: after each one, the top of the list reads like B. Each change's EV effect is the change
//! in return on table B from the list before it to the list after it, so the
//! effects add up exactly to (B on table B) − (A on table B).

use super::features::{RuleHit, apply_rule, high_min, subset_features};
use super::rule::{Rule, Strategy};
use crate::analysis::{Analyzer, Ratio};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKind {
    Removed,
    Added,
    Moved,
}

#[derive(Clone, Debug)]
pub struct Change {
    pub kind: ChangeKind,
    pub rule: Rule,
    /// 0-based line in A (removed, moved).
    pub from: Option<usize>,
    /// 0-based line in B (added, moved).
    pub to: Option<usize>,
    /// Change in return on table B (credits returned per credit bet).
    pub delta: f64,
}

/// Hands the two strategies play differently (holds of different EV on
/// table B), grouped by the rule that decides them in A and in B.
#[derive(Clone, Debug)]
pub struct Difference {
    /// Deciding rule (0-based, in the compared lists) in A and in B.
    pub a_rule: usize,
    pub b_rule: usize,
    /// Probability of a deal in this group.
    pub prob: f64,
    /// B's play minus A's play on these hands, credits per hand dealt.
    pub effect: f64,
    /// The group's hand where the choice matters most, with A's and B's
    /// holds and B's EV minus A's (credits, for that hand).
    pub hand: String,
    pub a_hold: u8,
    pub b_hold: u8,
    pub gain: f64,
}

#[derive(Clone, Debug)]
pub struct Comparison {
    /// Strategy A played on table B, exact.
    pub a_on_b: Ratio,
    /// Strategy B played on table B, exact.
    pub b_on_b: Ratio,
    /// Optimal play on table B.
    pub optimal_b: Ratio,
    pub bet: u32,
    /// Both lists as compared (see `normalize`).
    pub a: Strategy,
    pub b: Strategy,
    pub changes: Vec<Change>,
    /// Probability that a deal is played differently (holds of different
    /// EV on table B).
    pub differ: f64,
    /// Every group of differently played hands, largest |effect| first.
    /// The effects add up to B on B minus A on B, in credits per hand.
    pub differences: Vec<Difference>,
}

impl Comparison {
    /// What playing A's strategy on table B costs, credits per hand.
    pub fn cost_credits(&self) -> f64 {
        (self.b_on_b.to_f64() - self.a_on_b.to_f64()) * self.bet as f64
    }
}

/// Indices (in `a`) of a longest common subsequence of `a` and `b`.
fn lcs(a: &[Rule], b: &[Rule]) -> Vec<bool> {
    let (n, m) = (a.len(), b.len());
    let mut t = vec![vec![0u16; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            t[i][j] = if a[i] == b[j] {
                t[i + 1][j + 1] + 1
            } else {
                t[i + 1][j].max(t[i][j + 1])
            };
        }
    }
    let mut keep = vec![false; n];
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if a[i] == b[j] {
            keep[i] = true;
            i += 1;
            j += 1;
        } else if t[i + 1][j] >= t[i][j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    keep
}

/// The strategy without repeated rules (a repeat can never fire: the first
/// copy matches the same hands). Play is unchanged.
pub fn dedup(s: &Strategy) -> Strategy {
    let mut rules: Vec<Rule> = Vec::with_capacity(s.rules.len());
    for r in &s.rules {
        if !rules.contains(r) {
            rules.push(*r);
        }
    }
    Strategy { rules }
}

/// The list of changes turning A into B, and the strategy (as indices into
/// the combined rule pool) after each one. Pool: A's rules, then B's rules
/// not in A. Both must be free of repeated rules (see `dedup`).
pub fn edit_steps(a: &Strategy, b: &Strategy) -> (Vec<Rule>, Vec<Change>, Vec<Vec<usize>>) {
    let mut pool: Vec<Rule> = a.rules.clone();
    for r in &b.rules {
        if !pool.contains(r) {
            pool.push(*r);
        }
    }
    let id = |r: &Rule| pool.iter().position(|p| p == r).unwrap();
    let keep = lcs(&a.rules, &b.rules);
    let mut cur: Vec<usize> = (0..a.rules.len()).collect();
    let mut changes = vec![];
    let mut states = vec![cur.clone()];
    let change = |kind, rule, from, to| Change {
        kind,
        rule,
        from,
        to,
        delta: 0.0,
    };
    // Changes are applied top-down. An added or moved rule takes the key of
    // its line in B; a removed rule is taken out just before the next rule
    // below it that stays in place (one of the longest common subsequence).
    // "discard everything" is last in both lists, so it is in every longest
    // common subsequence: every removal has such a rule, and every
    // intermediate list is a valid strategy.
    let b_pos = |r: &Rule| b.rules.iter().position(|x| x == r);
    let mut order: Vec<(usize, u8, Change)> = vec![];
    for (i, r) in a.rules.iter().enumerate() {
        if b_pos(r).is_none() {
            let next = (i + 1..a.rules.len()).find(|&k| keep[k]).unwrap();
            let key = b_pos(&a.rules[next]).unwrap();
            order.push((key, 0, change(ChangeKind::Removed, *r, Some(i), None)));
        }
    }
    for (j, r) in b.rules.iter().enumerate() {
        let from = a.rules.iter().position(|x| x == r);
        let kind = match from {
            None => ChangeKind::Added,
            Some(i) if keep[i] => continue,
            Some(_) => ChangeKind::Moved,
        };
        order.push((j, 1, change(kind, *r, from, Some(j))));
    }
    order.sort_by_key(|(k, t, c)| (*k, *t, c.from));
    // Each added or moved rule goes right after its predecessor in B (or
    // first); that predecessor is already placed (it stays in place or has a
    // smaller key). Rules of the common subsequence never move, so at the
    // end each run of B is contiguous and in order: the list is B.
    for (_, _, c) in order {
        match c.kind {
            ChangeKind::Removed => {
                let i = c.from.unwrap();
                cur.retain(|&k| k != i);
            }
            _ => {
                let j = c.to.unwrap();
                let k = id(&c.rule);
                cur.retain(|&x| x != k);
                let at = match j {
                    0 => 0,
                    _ => {
                        let prev = id(&b.rules[j - 1]);
                        cur.iter().position(|&x| x == prev).unwrap() + 1
                    }
                };
                cur.insert(at, k);
            }
        }
        changes.push(c);
        states.push(cur.clone());
    }
    debug_assert_eq!(
        cur.iter().map(|&k| pool[k]).collect::<Vec<_>>(),
        b.rules,
        "edit steps must end at B"
    );
    (pool, changes, states)
}

/// Both lists as compared: combined pat-hand lines split into one line per
/// hand, repeated rules dropped. Play is unchanged; line numbers in a
/// `Comparison` refer to these lists.
pub fn normalize(s: &Strategy) -> Strategy {
    dedup(&super::split_pat_lines(s))
}

/// Compares strategy A with strategy B on table B (`pays`, `bet`). See
/// `normalize` for the lists compared.
pub fn compare(an: &Analyzer, pays: &[i64], bet: u32, a: &Strategy, b: &Strategy) -> Comparison {
    let (a, b) = (&normalize(a), &normalize(b));
    let (pool, mut changes, states) = edit_steps(a, b);
    let game = &an.game;
    let hi = high_min(game);
    let deals: f64 = an.classes.iter().map(|c| c.weight as f64).sum();
    // Σ weight × EV (credits) per state; differences are the effects.
    let mut sums = vec![0.0f64; states.len()];
    let mut hits: Vec<Option<u8>> = vec![None; pool.len()];
    let last = states.len() - 1;
    let mut differ = 0.0;
    let mut groups: std::collections::HashMap<(usize, usize), Difference> = Default::default();
    let (res_b, opt) = an.policy_and_optimal(pays, bet, |_, cl, evs| {
        let feats = subset_features(game, &cl.cards, hi);
        for (k, r) in pool.iter().enumerate() {
            hits[k] = match apply_rule(r, &feats) {
                RuleHit::Hold { mask, .. } => Some(mask),
                RuleHit::NoMatch => None,
            };
        }
        // Deciding pool rule and hold of a state.
        let decide = |st: &[usize]| {
            st.iter()
                .find_map(|&k| hits[k].map(|m| (k, m)))
                .unwrap_or((usize::MAX, 0))
        };
        for (s, st) in states.iter().enumerate() {
            sums[s] += cl.weight as f64 * evs.ev(decide(st).1 as usize);
        }
        let (ka, ha) = decide(&states[0]);
        let (kb, hb) = decide(&states[last]);
        if evs.cmp(ha as usize, hb as usize) != std::cmp::Ordering::Equal {
            let prob = cl.weight as f64 / deals;
            let gain = evs.ev(hb as usize) - evs.ev(ha as usize);
            differ += prob;
            let b_rule = b.rules.iter().position(|r| *r == pool[kb]).unwrap();
            let g = groups.entry((ka, b_rule)).or_insert_with(|| Difference {
                a_rule: ka,
                b_rule,
                prob: 0.0,
                effect: 0.0,
                hand: String::new(),
                a_hold: 0,
                b_hold: 0,
                gain: 0.0,
            });
            g.prob += prob;
            g.effect += prob * gain;
            if g.hand.is_empty() || gain.abs() > g.gain.abs() {
                g.hand = game.deck().hand_name(&cl.cards);
                (g.a_hold, g.b_hold, g.gain) = (ha, hb, gain);
            }
        }
        hb
    });
    let mut differences: Vec<Difference> = groups.into_values().collect();
    differences.sort_by(|x, y| {
        y.effect
            .abs()
            .total_cmp(&x.effect.abs())
            .then((x.a_rule, x.b_rule).cmp(&(y.a_rule, y.b_rule)))
    });
    // A on B exactly (a second pass; cheap next to the class loop above).
    let a_on_b = super::evaluate(an, pays, bet, a).ret;
    for (c, w) in changes.iter_mut().zip(sums.windows(2)) {
        c.delta = (w[1] - w[0]) / deals / bet as f64;
    }
    Comparison {
        a_on_b,
        b_on_b: res_b.ret,
        optimal_b: opt.ret,
        bet,
        a: a.clone(),
        b: b.clone(),
        changes,
        differ,
        differences,
    }
}
