//! Automated strategy generator (SPEC §4.3).
//!
//! 1. Build a library of candidate rules for the game and tier (made hands,
//!    groups by the game's rank groups, draw classes seen in play, the exact
//!    card combinations that are ever optimal, high-card rules, and qualifier
//!    variants the tier allows).
//! 2. For every suit class and every candidate that matches it, record the
//!    EV the rule would give up there (exact ties count as zero loss).
//! 3. Search orderings: greedy insertion (each step adds the rule and
//!    position that cut the total loss most), then local search — move each
//!    rule to its best position, drop rules that hurt, swap rules in and out
//!    at the line cap — until nothing improves.
//!
//! 4. Fit to the line cap (`fit`). Adjacent rules that no hand reaching
//!    them matches together are joined on one line (`super::compact`) and
//!    count as one line, so the search may keep more rules than lines:
//!    whenever joining frees lines, the cap on rules grows and the search
//!    fills the freed slots with the best remaining candidates. Rules worth
//!    less than `DEAD_RULE` are pruned, and never added.
//!
//! Guardrail: a dealt full house is never broken unless breaking it is an
//! optimal play (e.g. three aces in Double Bonus). Any other hold of a
//! dealt full house is forbidden like an ambiguous rule, so in practice
//! "full house" sits above every general trips or pair rule.
//!
//! Every candidate ordering is scored exactly from step 2's table; the final
//! strategy is re-scored by the exact evaluator.

use super::features::{RuleHit, Shape, apply_rule, high_min, subset_features, windows};
use super::rule::{ALL_RANKS, Cmp, Family, Pattern, Rule, Strategy};
use crate::analysis::Analyzer;
use crate::eval::HandKind;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Qualifiers {
    None,
    /// Flush penalty only (fp=0, fp>=1).
    FlushOnly,
    /// fp and sp, 0 / ≥1 / ≥2.
    All,
}

#[derive(Clone, Copy, Debug)]
pub struct Tier {
    pub name: &'static str,
    /// Lines including the final "discard everything".
    pub max_lines: usize,
    pub qualifiers: Qualifiers,
}

/// Default tiers (SPEC §4.3). Caps are configuration, not hard-wired logic.
pub const TIERS: [Tier; 3] = [
    Tier {
        name: "beginner",
        max_lines: 20,
        qualifiers: Qualifiers::None,
    },
    Tier {
        name: "intermediate",
        max_lines: 25,
        qualifiers: Qualifiers::FlushOnly,
    },
    Tier {
        name: "expert",
        max_lines: 40,
        qualifiers: Qualifiers::All,
    },
];

/// Allowed range for a tunable line cap (lines include "discard everything").
pub const MIN_LINES: usize = 3;
pub const MAX_LINES: usize = 200;

impl Tier {
    /// The same tier with a different line cap (for custom strategies).
    pub fn with_max_lines(self, max_lines: usize) -> Result<Tier, String> {
        if !(MIN_LINES..=MAX_LINES).contains(&max_lines) {
            return Err(format!("line cap must be {MIN_LINES}..={MAX_LINES}"));
        }
        Ok(Tier { max_lines, ..self })
    }
}

pub fn tier(name: &str) -> Result<Tier, String> {
    TIERS
        .iter()
        .find(|t| t.name == name)
        .copied()
        .ok_or_else(|| format!("unknown tier '{name}' (beginner, intermediate, expert)"))
}

/// Loss assigned where a rule cannot decide between holds of different EV:
/// large enough that the search never lets such a rule fire there.
const AMBIGUOUS: f64 = 1.0e3;
/// Rules that change the loss by less than this (credits per hand) are not
/// worth a line: the generator prunes them and never adds them.
pub const DEAD_RULE: f64 = 1.0e-7;
const NONE: u32 = u32::MAX;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Key {
    Nothing,
    Made(HandKind),
    Pair,
    TwoPair,
    Trips,
    Quads,
    Draw(Family, u8),
    Exact(u16, Option<bool>),
    High(u8),
    Pat,
}

fn rule_key(r: &Rule) -> Key {
    match r.pattern {
        Pattern::Nothing => Key::Nothing,
        Pattern::Made(k) => Key::Made(k),
        Pattern::Pair { .. } => Key::Pair,
        Pattern::TwoPair => Key::TwoPair,
        Pattern::Trips { .. } => Key::Trips,
        Pattern::Quads { .. } => Key::Quads,
        Pattern::Draw { family, n, .. } => Key::Draw(family, n),
        Pattern::Exact { ranks, suited } => Key::Exact(ranks, suited),
        Pattern::High { n, .. } => Key::High(n),
        Pattern::Pat(_) => Key::Pat,
    }
}

/// Pat hands a rule fully covers (bits as in `Pattern::Pat`).
fn pat_cover(r: &Rule) -> u8 {
    if r.has_qualifier() {
        return 0;
    }
    match r.pattern {
        Pattern::Pat(m) => m,
        Pattern::Made(k) => super::rule::pat_bit(k).map_or(0, |b| 1 << b),
        Pattern::Quads {
            ranks: ALL_RANKS,
            kicker: None,
        } => 1 << 2,
        _ => 0,
    }
}

const ALL_PATS: u8 = 0b11_1111;

fn subset_keys(f: &super::features::SubsetFeat, out: &mut Vec<Key>) {
    out.clear();
    match f.shape {
        Shape::Nothing => out.push(Key::Nothing),
        Shape::Made(k) => {
            out.push(Key::Made(k));
            out.push(Key::Pat);
        }
        Shape::Pair(_) => out.push(Key::Pair),
        Shape::TwoPair => out.push(Key::TwoPair),
        Shape::Trips { .. } => out.push(Key::Trips),
        Shape::Quads { kicker, .. } => {
            out.push(Key::Quads);
            if kicker.is_none() {
                out.push(Key::Pat);
            }
        }
        Shape::Distinct {
            family, suited, h, ..
        } => {
            if let Some(fam) = family {
                out.push(Key::Draw(fam, f.n));
            }
            out.push(Key::Exact(f.ranks, suited));
            if h == f.n {
                out.push(Key::High(f.n));
            }
        }
        Shape::Other => {}
    }
}

/// Builds the candidate rule library. Rule 0 is always "discard everything".
pub fn candidate_rules(an: &Analyzer, pays: &[i64], tier: &Tier) -> Vec<Rule> {
    let game = &an.game;
    let hi = high_min(game);
    let mut draws: HashSet<(Family, u8, u8, u8)> = HashSet::new();
    let mut exact: HashSet<(u16, Option<bool>)> = HashSet::new();
    for cl in &an.classes {
        let feats = subset_features(game, &cl.cards, hi);
        let evs = an.hold_evs(&cl.cards, pays);
        let best = evs.best();
        for f in &feats {
            if let Shape::Distinct {
                family,
                suited,
                w,
                h,
            } = f.shape
            {
                if let Some(fam) = family {
                    if f.n >= 3 {
                        draws.insert((fam, f.n, w, h));
                    }
                }
                if evs.cmp(f.mask as usize, best) == std::cmp::Ordering::Equal {
                    exact.insert((f.ranks, suited));
                }
            }
        }
    }

    let mut base: Vec<Rule> = vec![Rule::new(Pattern::Nothing)];
    let push = |v: &mut Vec<Rule>, p: Pattern| v.push(Rule::new(p));
    for k in [
        HandKind::RoyalFlush,
        HandKind::StraightFlush,
        HandKind::FullHouse,
        HandKind::Flush,
        HandKind::Straight,
    ] {
        push(&mut base, Pattern::Made(k));
    }
    // Combined pat-hand lines: every run of 2+ consecutive pat hands.
    for a in 0..6u8 {
        for b in a + 1..6u8 {
            let m = (a..=b).fold(0u8, |m, i| m | 1 << i);
            push(&mut base, Pattern::Pat(m));
        }
    }
    // Rank groups the pay table distinguishes.
    let rank_set = |v: &Option<Vec<String>>| -> u16 {
        v.as_ref().map_or(ALL_RANKS, |v| {
            super::rule::parse_ranks(&v.join(",")).unwrap_or(ALL_RANKS)
        })
    };
    let mut quad_groups: Vec<u16> = vec![ALL_RANKS];
    let mut kicker_lines: Vec<(u16, u16)> = vec![];
    for l in &game.def.lines {
        if l.hand == HandKind::FourOfAKind {
            let q = rank_set(&l.quad_ranks);
            if !quad_groups.contains(&q) {
                quad_groups.push(q);
            }
            if l.kicker_ranks.is_some() {
                kicker_lines.push((q, rank_set(&l.kicker_ranks)));
            }
        }
    }
    for &q in &quad_groups {
        push(
            &mut base,
            Pattern::Quads {
                ranks: q,
                kicker: None,
            },
        );
        push(
            &mut base,
            Pattern::Trips {
                ranks: q,
                kicker: None,
            },
        );
        push(&mut base, Pattern::Pair { ranks: q });
    }
    for &(q, k) in &kicker_lines {
        push(
            &mut base,
            Pattern::Quads {
                ranks: q,
                kicker: Some(k),
            },
        );
        push(
            &mut base,
            Pattern::Trips {
                ranks: q,
                kicker: Some(k),
            },
        );
    }
    push(
        &mut base,
        Pattern::Trips {
            ranks: 1 << 14,
            kicker: None,
        },
    );
    push(&mut base, Pattern::TwoPair);
    let high: u16 = (hi..=14).fold(0, |m, r| m | 1 << r);
    push(&mut base, Pattern::Pair { ranks: high });
    push(
        &mut base,
        Pattern::Pair {
            ranks: ALL_RANKS & !high,
        },
    );
    for r in 2..=14u8 {
        push(&mut base, Pattern::Pair { ranks: 1 << r });
    }
    let mut dv: Vec<_> = draws.into_iter().collect();
    dv.sort_unstable();
    dv.dedup();
    for (family, n, w, h) in dv {
        let w_opts: &[Option<u8>] = if family == Family::Flush {
            &[None]
        } else {
            &[Some(w), None]
        };
        for (wo, ho) in w_opts.iter().flat_map(|&wo| [(wo, Some(h)), (wo, None)]) {
            push(
                &mut base,
                Pattern::Draw {
                    family,
                    n,
                    w: wo,
                    h: ho,
                },
            );
        }
    }
    for n in 1..=4u8 {
        let suits: &[Option<bool>] = if n == 1 {
            &[None]
        } else {
            &[None, Some(true), Some(false)]
        };
        for &s in suits {
            base.push(Rule::new(Pattern::High { n, suited: s }));
            base.push(Rule {
                prefer_low: true,
                ..Rule::new(Pattern::High { n, suited: s })
            });
        }
    }
    let mut ev: Vec<_> = exact.into_iter().collect();
    ev.sort_unstable();
    for (ranks, suited) in ev {
        push(&mut base, Pattern::Exact { ranks, suited });
    }

    // Qualifier variants.
    let mut out: Vec<Rule> = Vec::new();
    let mut seen: HashSet<Rule> = HashSet::new();
    let levels: &[Cmp] = match tier.qualifiers {
        Qualifiers::None => &[],
        Qualifiers::FlushOnly => &[Cmp::Eq(0), Cmp::Ge(1)],
        Qualifiers::All => &[Cmp::Eq(0), Cmp::Ge(1), Cmp::Ge(2)],
    };
    for r in base {
        if seen.insert(r) {
            out.push(r);
        }
        let (fp_ok, sp_ok) = match r.pattern {
            Pattern::Draw { family, .. } => (family != Family::Straight, family != Family::Flush),
            Pattern::Exact { ranks, suited } => (suited != Some(false), windows(ranks) > 0),
            Pattern::High { n, suited } => (n == 1 || suited == Some(true), true),
            _ => (false, false),
        };
        for &c in levels {
            if fp_ok {
                let v = Rule { fp: Some(c), ..r };
                if seen.insert(v) {
                    out.push(v);
                }
            }
            if sp_ok && tier.qualifiers == Qualifiers::All {
                let v = Rule { sp: Some(c), ..r };
                if seen.insert(v) {
                    out.push(v);
                }
            }
        }
    }
    out
}

/// For each class: the loss (credits per hand dealt) of every candidate rule
/// that matches it. Stored both by class and by rule.
pub struct MatchTable {
    pub rules: Vec<Rule>,
    cls_off: Vec<u32>,
    cls_rule: Vec<u32>,
    cls_loss: Vec<f64>,
    rule_off: Vec<u32>,
    rule_cls: Vec<u32>,
    rule_loss: Vec<f64>,
}

impl MatchTable {
    pub fn build(an: &Analyzer, pays: &[i64], rules: Vec<Rule>) -> MatchTable {
        assert_eq!(rules[0].pattern, Pattern::Nothing);
        let game = &an.game;
        let hi = high_min(game);
        let deals: f64 = an.classes.iter().map(|c| c.weight as f64).sum();
        let mut buckets: HashMap<Key, Vec<u32>> = HashMap::new();
        for (i, r) in rules.iter().enumerate() {
            buckets.entry(rule_key(r)).or_default().push(i as u32);
        }
        let mut cls_off = vec![0u32];
        let (mut cls_rule, mut cls_loss) = (Vec::new(), Vec::new());
        let mut keys = Vec::new();
        let mut matched: Vec<u32> = Vec::new();
        for cl in &an.classes {
            let feats = subset_features(game, &cl.cards, hi);
            let evs = an.hold_evs(&cl.cards, pays);
            let best = evs.best();
            let best_ev = evs.ev(best);
            let w = cl.weight as f64 / deals;
            let full_house = an.game.hand_info(&cl.cards).kind == HandKind::FullHouse;
            matched.clear();
            for f in &feats {
                subset_keys(f, &mut keys);
                for k in &keys {
                    if let Some(b) = buckets.get(k) {
                        for &ri in b {
                            if super::features::rule_matches(&rules[ri as usize], f) {
                                matched.push(ri);
                            }
                        }
                    }
                }
            }
            matched.sort_unstable();
            matched.dedup();
            for &ri in &matched {
                let RuleHit::Hold { mask, alternatives } = apply_rule(&rules[ri as usize], &feats)
                else {
                    unreachable!()
                };
                let m = mask as usize;
                let optimal = evs.cmp(m, best) == std::cmp::Ordering::Equal;
                let loss = if alternatives
                    .iter()
                    .any(|&a| evs.cmp(a as usize, m) != std::cmp::Ordering::Equal)
                {
                    AMBIGUOUS
                } else if full_house && m != 31 && !optimal {
                    // Full house guardrail: never break a dealt full house
                    // unless that is an optimal play.
                    AMBIGUOUS
                } else if evs.cmp(m, best) == std::cmp::Ordering::Equal {
                    0.0
                } else {
                    w * (best_ev - evs.ev(m))
                };
                cls_rule.push(ri);
                cls_loss.push(loss);
            }
            cls_off.push(cls_rule.len() as u32);
        }
        // Invert.
        let nr = rules.len();
        let mut counts = vec![0u32; nr + 1];
        for &r in &cls_rule {
            counts[r as usize + 1] += 1;
        }
        for i in 0..nr {
            counts[i + 1] += counts[i];
        }
        let rule_off = counts.clone();
        let mut fill = counts;
        let mut rule_cls = vec![0u32; cls_rule.len()];
        let mut rule_loss = vec![0f64; cls_rule.len()];
        for c in 0..an.classes.len() {
            for e in cls_off[c] as usize..cls_off[c + 1] as usize {
                let r = cls_rule[e] as usize;
                let slot = fill[r] as usize;
                rule_cls[slot] = c as u32;
                rule_loss[slot] = cls_loss[e];
                fill[r] += 1;
            }
        }
        MatchTable {
            rules,
            cls_off,
            cls_rule,
            cls_loss,
            rule_off,
            rule_cls,
            rule_loss,
        }
    }

    pub fn entries(&self) -> usize {
        self.cls_rule.len()
    }
    fn classes(&self) -> usize {
        self.cls_off.len() - 1
    }
    fn inv(&self, r: u32) -> std::ops::Range<usize> {
        self.rule_off[r as usize] as usize..self.rule_off[r as usize + 1] as usize
    }
}

struct Search<'a> {
    t: &'a MatchTable,
    max_rules: usize,
    /// Tie preference for ordinary insertions (see `insert_eval_pref`).
    tie_top: bool,
    /// Smallest gain (credits/hand) for which `fill` adds a rule.
    min_gain: f64,
    /// Pat hands each rule covers, and how many listed rules cover each.
    cover: Vec<u8>,
    cover_count: [u32; 6],
    order: Vec<u32>,
    pos: Vec<u32>,
    fired: Vec<u32>,
    cur: Vec<f64>,
    total: f64,
    buckets: Vec<f64>,
}

/// Improvements smaller than this (credits/hand) are treated as noise.
const EPS: f64 = 1e-12;

impl<'a> Search<'a> {
    fn new(t: &'a MatchTable, max_rules: usize) -> Search<'a> {
        let nc = t.classes();
        let mut pos = vec![NONE; t.rules.len()];
        pos[0] = 0;
        let mut cur = vec![0.0; nc];
        for c in 0..nc {
            let e = (t.cls_off[c]..t.cls_off[c + 1])
                .find(|&e| t.cls_rule[e as usize] == 0)
                .expect("nothing matches all");
            cur[c] = t.cls_loss[e as usize];
        }
        let total = cur.iter().sum();
        let cover = t.rules.iter().map(pat_cover).collect();
        Search {
            t,
            max_rules,
            tie_top: false,
            min_gain: DEAD_RULE,
            cover,
            cover_count: [0; 6],
            order: vec![],
            pos,
            fired: vec![0; nc],
            cur,
            total,
            buckets: vec![],
        }
    }

    fn renumber(&mut self, from: usize) {
        for i in from..self.order.len() {
            self.pos[self.order[i] as usize] = i as u32;
        }
        self.pos[0] = self.order.len() as u32;
    }

    /// Best position to insert rule r and the change in total loss.
    fn insert_eval(&mut self, r: u32) -> (f64, usize) {
        self.insert_eval_pref(r, self.tie_top)
    }

    /// Best position for r. Among (near-)equal deltas, `top` keeps the
    /// highest position (a specific rule then shadows the general rule below
    /// it, so the general rule can move later — used by bursts); otherwise
    /// the lowest.
    fn insert_eval_pref(&mut self, r: u32, top: bool) -> (f64, usize) {
        let len = self.order.len();
        self.buckets.clear();
        self.buckets.resize(len + 1, 0.0);
        for e in self.t.inv(r) {
            let c = self.t.rule_cls[e] as usize;
            let fp = self.pos[self.fired[c] as usize] as usize;
            self.buckets[fp] += self.t.rule_loss[e] - self.cur[c];
        }
        let (mut best, mut best_p, mut acc) = (f64::INFINITY, len, 0.0);
        for p in (0..=len).rev() {
            acc += self.buckets[p];
            let better = if top {
                acc <= best + EPS
            } else {
                acc < best - EPS
            };
            if better {
                best = best.min(acc);
                best_p = p;
            }
        }
        (best, best_p)
    }

    /// Removing r would leave some pat hand without a line.
    fn required(&self, r: u32) -> bool {
        let c = self.cover[r as usize];
        (0..6).any(|b| c >> b & 1 == 1 && self.cover_count[b] <= 1)
    }

    fn insert(&mut self, r: u32, p: usize) {
        for b in 0..6 {
            if self.cover[r as usize] >> b & 1 == 1 {
                self.cover_count[b] += 1;
            }
        }
        self.order.insert(p, r);
        self.renumber(p);
        let pr = self.pos[r as usize];
        for e in self.t.inv(r) {
            let c = self.t.rule_cls[e] as usize;
            if pr < self.pos[self.fired[c] as usize] {
                self.total += self.t.rule_loss[e] - self.cur[c];
                self.fired[c] = r;
                self.cur[c] = self.t.rule_loss[e];
            }
        }
    }

    fn next_for(&self, c: usize, skip: u32) -> (u32, f64) {
        let (mut br, mut bp, mut bl) = (0u32, u32::MAX, 0.0);
        for e in self.t.cls_off[c] as usize..self.t.cls_off[c + 1] as usize {
            let r = self.t.cls_rule[e];
            let p = self.pos[r as usize];
            if r != skip && p != NONE && p < bp {
                (br, bp, bl) = (r, p, self.t.cls_loss[e]);
            }
        }
        (br, bl)
    }

    fn removal_delta(&self, r: u32) -> f64 {
        let mut d = 0.0;
        for e in self.t.inv(r) {
            let c = self.t.rule_cls[e] as usize;
            if self.fired[c] == r {
                d += self.next_for(c, r).1 - self.cur[c];
            }
        }
        d
    }

    fn remove(&mut self, r: u32) -> usize {
        for b in 0..6 {
            if self.cover[r as usize] >> b & 1 == 1 {
                self.cover_count[b] -= 1;
            }
        }
        let p = self.pos[r as usize] as usize;
        self.order.remove(p);
        self.pos[r as usize] = NONE;
        self.renumber(p);
        for e in self.t.inv(r) {
            let c = self.t.rule_cls[e] as usize;
            if self.fired[c] == r {
                let (nr, nl) = self.next_for(c, r);
                self.total += nl - self.cur[c];
                self.fired[c] = nr;
                self.cur[c] = nl;
            }
        }
        p
    }

    fn best_insertion(&mut self, exclude: u32) -> Option<(f64, u32, usize)> {
        let mut best: Option<(f64, u32, usize)> = None;
        for r in 1..self.t.rules.len() as u32 {
            if self.pos[r as usize] != NONE || r == exclude {
                continue;
            }
            let (d, p) = self.insert_eval(r);
            if best.is_none_or(|b| d < b.0 - EPS) {
                best = Some((d, r, p));
            }
        }
        best
    }

    fn fill(&mut self) -> bool {
        let mut changed = false;
        while self.order.len() < self.max_rules {
            match self.best_insertion(NONE) {
                Some((d, r, p)) if d < -self.min_gain => {
                    self.insert(r, p);
                    changed = true;
                }
                _ => break,
            }
        }
        changed
    }

    /// Move every rule to its best position; drop rules that only hurt.
    fn moves(&mut self) -> bool {
        let mut changed = false;
        for r in self.order.clone() {
            if self.pos[r as usize] == NONE {
                continue;
            }
            let before = self.total;
            let required = self.required(r);
            let old = self.remove(r);
            let (d, p) = self.insert_eval(r);
            if required {
                // Required for pat-hand coverage: always stays; best position.
                if self.total + d < before - EPS {
                    self.insert(r, p);
                    changed = true;
                } else {
                    self.insert(r, old);
                }
            } else if self.total + d.min(0.0) < before - EPS {
                if d < -EPS {
                    self.insert(r, p);
                }
                changed = true;
            } else {
                self.insert(r, old);
            }
        }
        changed
    }

    /// At the cap: try replacing each rule (cheapest first) with the best
    /// rule from outside the list.
    fn swaps(&mut self) -> bool {
        if self.order.len() < self.max_rules {
            return false;
        }
        let mut changed = false;
        let mut costs: Vec<(f64, u32)> = self
            .order
            .iter()
            .map(|&r| (self.removal_delta(r), r))
            .collect();
        costs.sort_by(|a, b| a.0.total_cmp(&b.0));
        for &(_, r) in &costs {
            if self.pos[r as usize] == NONE || self.required(r) {
                continue;
            }
            let before = self.total;
            let old = self.remove(r);
            match self.best_insertion(r) {
                Some((d, q, p)) if self.total + d < before - EPS => {
                    self.insert(q, p);
                    changed = true;
                }
                _ => self.insert(r, old),
            }
        }
        changed
    }

    /// Resets the state to exactly this ordering.
    fn restore(&mut self, order: &[u32]) {
        for r in self.order.clone() {
            self.remove(r);
        }
        for (i, &r) in order.iter().enumerate() {
            self.insert(r, i);
        }
        self.resync();
    }

    /// Compound move: insert a promising outside rule (dropping the
    /// cheapest removable rule if at the cap), re-optimise every position,
    /// and keep the result only if the total improved. Finds changes that
    /// need two coordinated steps (e.g. a specific trips rule above full
    /// house plus the generic trips rule below it).
    fn kicks(&mut self, tries: usize) -> bool {
        let mut cands: Vec<(f64, u32)> = vec![];
        for r in 1..self.t.rules.len() as u32 {
            if self.pos[r as usize] == NONE {
                let (d, _) = self.insert_eval(r);
                if d.is_finite() && d < AMBIGUOUS / 2.0 {
                    cands.push((d, r));
                }
            }
        }
        cands.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let mut changed = false;
        for &(_, q) in cands.iter().take(tries) {
            if self.pos[q as usize] != NONE {
                continue;
            }
            let snapshot = self.order.clone();
            let before = self.total;
            if self.order.len() >= self.max_rules {
                let cheapest = self
                    .order
                    .iter()
                    .filter(|&&r| !self.required(r))
                    .map(|&r| (self.removal_delta(r), r))
                    .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
                match cheapest {
                    Some((_, r)) => {
                        self.remove(r);
                    }
                    None => continue,
                }
            }
            let (_, p) = self.insert_eval(q);
            self.insert(q, p);
            self.moves();
            self.moves();
            self.resync();
            if self.total < before - EPS {
                changed = true;
            } else {
                self.restore(&snapshot);
            }
        }
        changed
    }

    /// Shrinks to the cap by dropping the cheapest removable rules.
    fn shrink_to_cap(&mut self) {
        let mut since_moves = 0;
        while self.order.len() > self.max_rules {
            let r = self
                .order
                .iter()
                .filter(|&&r| !self.required(r))
                .map(|&r| (self.removal_delta(r), r))
                .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)))
                .map(|x| x.1);
            let Some(r) = r else { break };
            self.remove(r);
            since_moves += 1;
            if since_moves >= 5 {
                self.moves();
                since_moves = 0;
            }
        }
        self.resync();
    }

    /// Family burst: insert every unused rule of one family at once, let
    /// them settle, trim back to the cap, keep only if better. Finds
    /// restructurings that need several coordinated steps (e.g. splitting
    /// trips by rank around full house).
    fn burst(&mut self, family: &[u32]) -> bool {
        let fresh: Vec<u32> = family
            .iter()
            .copied()
            .filter(|&r| self.pos[r as usize] == NONE)
            .collect();
        if fresh.is_empty() {
            return false;
        }
        let snapshot = self.order.clone();
        let before = self.total;
        let cap = self.max_rules;
        self.max_rules = usize::MAX;
        for q in fresh {
            let (_, p) = self.insert_eval_pref(q, true);
            self.insert(q, p);
        }
        self.moves();
        self.moves();
        self.max_rules = cap;
        self.shrink_to_cap();
        self.moves();
        self.resync();
        if self.total < before - EPS {
            true
        } else {
            self.restore(&snapshot);
            false
        }
    }

    /// Re-sums the running total, which drifts slightly from incremental
    /// updates (especially around the large AMBIGUOUS sentinel).
    fn resync(&mut self) {
        self.total = self.cur.iter().sum();
    }

    /// Dead-rule pruning: repeatedly drops the listed rule whose removal
    /// costs least, while that cost is under `DEAD_RULE` (rules that never
    /// decide a hand cost nothing). Rules needed for pat-hand coverage stay.
    fn prune_dead(&mut self) -> bool {
        let mut changed = false;
        loop {
            let cheapest = self
                .order
                .iter()
                .filter(|&&r| !self.required(r))
                .map(|&r| (self.removal_delta(r), r))
                .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
            match cheapest {
                Some((d, r)) if d < DEAD_RULE => {
                    self.remove(r);
                    changed = true;
                }
                _ => break,
            }
        }
        self.resync();
        changed
    }

    /// Written lines the list needs, counting "discard everything", when
    /// adjacent rules are joined as `super::compact` joins them (same
    /// greedy grouping, from this search's own match table).
    fn line_count(&self) -> usize {
        let n = self.order.len();
        // min_next[p]: earliest later listed rule that also matches a hand
        // the rule at position p decides.
        let mut min_next = vec![usize::MAX; n + 1];
        for c in 0..self.t.classes() {
            let fp = self.pos[self.fired[c] as usize] as usize;
            let mut next = usize::MAX;
            for e in self.t.cls_off[c] as usize..self.t.cls_off[c + 1] as usize {
                let p = self.pos[self.t.cls_rule[e] as usize];
                if p != NONE && (p as usize) > fp {
                    next = next.min(p as usize);
                }
            }
            min_next[fp] = min_next[fp].min(next);
        }
        let mut lines = 1; // "discard everything" (position n) stands alone
        let mut limit = 0usize;
        for p in 0..n {
            if p > 0 && p < limit {
                limit = limit.min(min_next[p]);
            } else {
                lines += 1;
                limit = min_next[p];
            }
        }
        lines
    }
}

/// Local search to a local optimum: reposition, refill, swap; when those
/// stall, try compound moves and family bursts.
fn improve(s: &mut Search, families: &[Vec<u32>]) {
    for _ in 0..50 {
        let a = s.moves();
        s.resync();
        let b = s.fill();
        s.resync();
        let c = s.swaps();
        s.resync();
        if a || b || c || s.kicks(KICK_TRIES) {
            continue;
        }
        let mut burst = false;
        for f in families {
            burst |= s.burst(f);
        }
        if !burst {
            break;
        }
    }
}

/// Candidate rules tried per round of compound moves.
const KICK_TRIES: usize = 8;

/// Rule families for bursts: group rules by kind (pairs, trips, quads,
/// pat hands) and draws by family and size. Exact-card rules are left out
/// (too many to insert at once).
fn families(table: &MatchTable) -> Vec<Vec<u32>> {
    let mut map: HashMap<(u8, u8, u8), Vec<u32>> = HashMap::new();
    for (i, r) in table.rules.iter().enumerate() {
        let key = match r.pattern {
            Pattern::Pair { .. } | Pattern::TwoPair => (0, 0, 0),
            Pattern::Trips { .. } => (1, 0, 0),
            Pattern::Quads { .. } => (2, 0, 0),
            Pattern::Made(_) | Pattern::Pat(_) => (3, 0, 0),
            Pattern::Draw { family, n, .. } => (4, family as u8, n),
            Pattern::High { .. } => (5, 0, 0),
            Pattern::Exact { .. } | Pattern::Nothing => continue,
        };
        map.entry(key).or_default().push(i as u32);
    }
    let mut v: Vec<_> = map.into_iter().collect();
    v.sort_by_key(|(k, _)| *k);
    v.into_iter().map(|(_, r)| r).collect()
}

/// How to cover the pat hands at the start of a search.
#[derive(Clone, Copy, Debug)]
enum PatStart {
    /// One combined line.
    Combined,
    /// Six separate lines.
    Separate,
}

fn pin_made(s: &mut Search, table: &MatchTable, how: PatStart) {
    // Every pat hand (royal flush … straight) must have a line, so no
    // strategy leaves a dealt pat hand unaddressed. The search may later
    // split, merge or reorder these lines (e.g. 4 to a royal above a flush).
    let pats: Vec<Rule> = match how {
        PatStart::Combined => vec![Rule::new(Pattern::Pat(ALL_PATS))],
        PatStart::Separate => vec![
            Rule::new(Pattern::Made(HandKind::RoyalFlush)),
            Rule::new(Pattern::Made(HandKind::StraightFlush)),
            Rule::new(Pattern::Quads {
                ranks: ALL_RANKS,
                kicker: None,
            }),
            Rule::new(Pattern::Made(HandKind::FullHouse)),
            Rule::new(Pattern::Made(HandKind::Flush)),
            Rule::new(Pattern::Made(HandKind::Straight)),
        ],
    };
    for p in pats {
        let r = table.rules.iter().position(|x| *x == p).unwrap() as u32;
        let (_, pos) = s.insert_eval(r);
        s.insert(r, pos);
    }
}

/// Forward: greedy insertion up to the cap, then local search.
fn search_forward<'a>(
    table: &'a MatchTable,
    cap: usize,
    how: PatStart,
    fam: &[Vec<u32>],
    tie_top: bool,
) -> Search<'a> {
    let mut s = Search::new(table, cap);
    s.tie_top = tie_top;
    pin_made(&mut s, table, how);
    s.fill();
    s.resync();
    improve(&mut s, fam);
    s
}

/// Backward: grow a long list without the cap, then repeatedly drop the
/// rule whose removal costs least (re-optimising positions as it shrinks),
/// then local search at the cap.
fn search_backward<'a>(
    table: &'a MatchTable,
    cap: usize,
    how: PatStart,
    fam: &[Vec<u32>],
    tie_top: bool,
) -> Search<'a> {
    let mut s = Search::new(table, (cap * 4).max(80));
    s.tie_top = tie_top;
    pin_made(&mut s, table, how);
    s.fill();
    s.resync();
    s.moves();
    s.resync();
    s.max_rules = cap;
    s.shrink_to_cap();
    improve(&mut s, fam);
    s
}

/// Rounds of `fit` (each re-runs the local search at a new rule cap).
const FIT_ROUNDS: usize = 10;

/// Fits the search to `lines` written lines (see the module docs): prune
/// dead rules, count lines with joining, then grow the rule cap into freed
/// lines (or shrink it if over) and search again, until the count settles.
/// Leaves `s` at the lowest-loss ordering that fits.
fn fit(s: &mut Search, fam: &[Vec<u32>], lines: usize) {
    let mut best: Option<(f64, Vec<u32>)> = None;
    let mut seen: HashSet<Vec<u32>> = HashSet::new();
    for round in 0..FIT_ROUNDS {
        s.prune_dead();
        let n = s.line_count();
        if n <= lines && best.as_ref().is_none_or(|b| s.total < b.0 - EPS) {
            best = Some((s.total, s.order.clone()));
        }
        if !seen.insert(s.order.clone()) || (n == lines && round > 0) {
            break;
        }
        let len = s.order.len();
        if n > lines {
            s.max_rules = len.saturating_sub(n - lines);
            s.shrink_to_cap();
        } else {
            s.max_rules = len + (lines - n);
        }
        improve(s, fam);
        s.resync();
    }
    if let Some((_, order)) = best {
        s.restore(&order);
    }
}

/// Warm start: begin from an existing strategy (e.g. the tier below). The
/// rule cap starts at the seed's own size (its lines may be joined); `fit`
/// then brings it to the line cap.
fn search_seeded<'a>(
    table: &'a MatchTable,
    cap: usize,
    seed: &Strategy,
    tie_top: bool,
) -> Option<Search<'a>> {
    let index: HashMap<Rule, u32> = table
        .rules
        .iter()
        .enumerate()
        .map(|(i, r)| (*r, i as u32))
        .collect();
    let cap = cap.max(seed.rules.len());
    let mut s = Search::new(table, cap);
    s.tie_top = tie_top;
    for r in seed.rules.iter().filter(|r| r.pattern != Pattern::Nothing) {
        let &i = index.get(r)?;
        if s.order.len() < cap && s.pos[i as usize] == NONE {
            let at = s.order.len();
            s.insert(i, at);
        }
    }
    if s.cover_count.iter().any(|&c| c == 0) {
        return None;
    }
    s.resync();
    Some(s)
}

pub struct Generated {
    pub strategy: Strategy,
    /// Search's own loss estimate, credits per hand (re-checked exactly by
    /// the evaluator).
    pub loss: f64,
    pub candidates: usize,
    pub entries: usize,
}

/// Can a rule appear in a strategy of this tier (its qualifiers)?
pub fn tier_allows(tier: &Tier, r: &Rule) -> bool {
    let ok = |c: Option<Cmp>, allowed: &[Cmp]| c.is_none_or(|c| allowed.contains(&c));
    match tier.qualifiers {
        Qualifiers::None => !r.has_qualifier(),
        Qualifiers::FlushOnly => r.sp.is_none() && ok(r.fp, &[Cmp::Eq(0), Cmp::Ge(1)]),
        Qualifiers::All => {
            let all = [Cmp::Eq(0), Cmp::Ge(1), Cmp::Ge(2)];
            ok(r.fp, &all) && ok(r.sp, &all)
        }
    }
}

/// Generates the lowest-loss strategy it can find within the tier's line
/// cap, with joined lines counting once.
/// Each of `seeds` (typically the tier below, and the same tier's lists for
/// other pay tables of the game) is an extra starting point: its rules join
/// the candidate library (if the tier allows them) and the search starts
/// from it, so the result is never worse than a seed that fits the cap.
pub fn generate(an: &Analyzer, pays: &[i64], tier: &Tier, seeds: &[&Strategy]) -> Generated {
    let mut rules = candidate_rules(an, pays, tier);
    let mut known: HashSet<Rule> = rules.iter().copied().collect();
    for r in seeds.iter().flat_map(|s| s.rules.iter()) {
        if r.pattern != Pattern::Nothing && tier_allows(tier, r) && known.insert(*r) {
            rules.push(*r);
        }
    }
    let table = MatchTable::build(an, pays, rules);
    let cap = tier.max_lines.saturating_sub(1);
    let fam = families(&table);
    // Debug timing (native only: Instant is unavailable in WebAssembly).
    let debug = !cfg!(target_arch = "wasm32") && std::env::var("OVP_DEBUG").is_ok();
    if debug {
        eprintln!(
            "[{}] candidates {} entries {}",
            tier.name,
            table.rules.len(),
            table.entries()
        );
    }
    // Independent starting points; each wins on some tables, so run them all
    // (in parallel natively; sequentially in WebAssembly) and keep the best.
    #[derive(Clone, Copy)]
    enum Job {
        Forward(PatStart, bool),
        Backward(PatStart, bool),
        Seeded(usize, bool),
    }
    let mut jobs = vec![];
    for tie_top in [false, true] {
        for how in [PatStart::Combined, PatStart::Separate] {
            jobs.push(Job::Forward(how, tie_top));
            jobs.push(Job::Backward(how, tie_top));
        }
        for i in 0..seeds.len() {
            jobs.push(Job::Seeded(i, tie_top));
        }
    }
    let run = |job: Job| -> Option<Search> {
        let t = debug.then(std::time::Instant::now);
        let mut r = match job {
            Job::Forward(h, tt) => Some(search_forward(&table, cap, h, &fam, tt)),
            Job::Backward(h, tt) => Some(search_backward(&table, cap, h, &fam, tt)),
            Job::Seeded(i, tt) => search_seeded(&table, cap, seeds[i], tt),
        };
        if let Some(s) = &mut r {
            fit(s, &fam, tier.max_lines);
        }
        if let (Some(t), Some(r)) = (t, &r) {
            eprintln!(
                "  run loss {:.7} rules {} lines {} {:.1}s",
                r.total,
                r.order.len(),
                r.line_count(),
                t.elapsed().as_secs_f64()
            );
        }
        r
    };
    #[cfg(not(target_arch = "wasm32"))]
    let runs: Vec<Search> = std::thread::scope(|sc| {
        let handles: Vec<_> = jobs.iter().map(|&j| sc.spawn(move || run(j))).collect();
        handles
            .into_iter()
            .filter_map(|h| h.join().expect("search thread"))
            .collect()
    });
    #[cfg(target_arch = "wasm32")]
    let runs: Vec<Search> = jobs.iter().filter_map(|&j| run(j)).collect();
    // Lowest loss; ties go to the earliest job (deterministic).
    let mut s = runs
        .into_iter()
        .reduce(|a, b| if b.total < a.total - EPS { b } else { a })
        .unwrap();
    s.resync();
    let mut rules: Vec<Rule> = s.order.iter().map(|&r| table.rules[r as usize]).collect();
    rules.push(Rule::new(Pattern::Nothing));
    let tidy = super::tidy(&Strategy::new(rules));
    // Reading order (natural_order) unless it needs more lines than the
    // search's own order once joined; the search's order always fits.
    let natural = super::compact(an, &super::natural_order(an, pays, &tidy));
    let own = super::compact(an, &tidy);
    let strategy = if own.line_count() < natural.line_count() {
        own
    } else {
        natural
    };
    // Plainest wording with identical play (ends with its own compact).
    let strategy = super::simplify(an, &strategy);
    assert!(strategy.line_count() <= tier.max_lines.max(s.line_count()));
    Generated {
        strategy,
        loss: s.total,
        candidates: table.rules.len(),
        entries: table.entries(),
    }
}

/// All tiers in order, each warm-started from the one below.
pub fn generate_tiers(an: &Analyzer, pays: &[i64], tiers: &[Tier]) -> Vec<Generated> {
    let mut out: Vec<Generated> = Vec::new();
    for t in tiers {
        let seeds: Vec<&Strategy> = out.last().map(|g| &g.strategy).into_iter().collect();
        let g = generate(an, pays, t, &seeds);
        out.push(g);
    }
    out
}
