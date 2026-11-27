//! Simplification pass: plainer wording, identical play.
//!
//! Generated lists can carry qualifiers that do no work:
//! - **by definition:** `3 to a royal h=2` next to `3 to a royal` (a 3-card
//!   royal draw has 2 or 3 high cards, so together they are just
//!   `3 to a royal`);
//! - **by position:** `4 to a flush h=2, h=1, h=0` once every 3 to a royal
//!   has been taken above (a 4-flush left over can't have 3 high cards), so
//!   the three rules are just `4 to a flush`.
//!
//! Neither case is listed by hand. Each candidate rewrite is checked by
//! exact enumeration: it is accepted only if **every hand class keeps the
//! identical hold** (not merely an equal-EV one), and no rule is left with a
//! tie it didn't already have. Candidates, cheapest wording first:
//! - drop one qualifier from a rule, or all of them;
//! - collapse a run of sibling rules that differ only in one qualifier's
//!   value into one rule without it;
//! - remove a rule when another rule in the list is the same rule with
//!   fewer qualifiers (or move that plainer rule up into its place).
//!
//! The best accepted candidate (fewest qualifiers, then shortest text, then
//! fewest lines) is applied, and the search repeats until nothing changes.
//! Duplicate rules are then dropped and the list is joined into lines again
//! (`super::compact`). A rewrite never needs more lines than the list had.

use super::features::{RuleHit, apply_rule, high_min, subset_features};
use super::rule::{ALL_RANKS, Pattern, Rule, Strategy};
use crate::analysis::Analyzer;
use std::collections::HashMap;

/// A qualifier that a simpler rule can leave out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Qual {
    /// `w=N` on a draw.
    W,
    /// `h=N` on a draw.
    H,
    Fp,
    Sp,
    PreferLow,
    /// A rank set on pairs, trips and quads (dropped: every rank).
    Ranks,
    /// `suited` / `unsuited` on `N high cards`.
    Suited,
}

pub const QUALS: [Qual; 7] = [
    Qual::W,
    Qual::H,
    Qual::Fp,
    Qual::Sp,
    Qual::PreferLow,
    Qual::Ranks,
    Qual::Suited,
];

/// Does the rule carry this qualifier?
pub fn has(r: &Rule, q: Qual) -> bool {
    match (q, r.pattern) {
        (Qual::W, Pattern::Draw { w, .. }) => w.is_some(),
        (Qual::H, Pattern::Draw { h, .. }) => h.is_some(),
        (Qual::Fp, _) => r.fp.is_some(),
        (Qual::Sp, _) => r.sp.is_some(),
        (Qual::PreferLow, _) => r.prefer_low,
        (
            Qual::Ranks,
            Pattern::Pair { ranks } | Pattern::Trips { ranks, .. } | Pattern::Quads { ranks, .. },
        ) => ranks != ALL_RANKS,
        (Qual::Suited, Pattern::High { suited, .. }) => suited.is_some(),
        _ => false,
    }
}

/// The rule without this qualifier (unchanged if it has none).
pub fn drop(r: &Rule, q: Qual) -> Rule {
    let mut r = *r;
    match (q, &mut r.pattern) {
        (Qual::W, Pattern::Draw { w, .. }) => *w = None,
        (Qual::H, Pattern::Draw { h, .. }) => *h = None,
        (Qual::Fp, _) => r.fp = None,
        (Qual::Sp, _) => r.sp = None,
        (Qual::PreferLow, _) => r.prefer_low = false,
        (
            Qual::Ranks,
            Pattern::Pair { ranks } | Pattern::Trips { ranks, .. } | Pattern::Quads { ranks, .. },
        ) => *ranks = ALL_RANKS,
        (Qual::Suited, Pattern::High { suited, .. }) => *suited = None,
        _ => {}
    }
    r
}

/// Number of qualifiers the rule carries.
pub fn qualifiers(r: &Rule) -> usize {
    QUALS.iter().filter(|&&q| has(r, q)).count()
}

/// The rule with no qualifiers.
pub fn bare(r: &Rule) -> Rule {
    QUALS.iter().fold(*r, |r, &q| drop(&r, q))
}

/// The rule and every rule made from it by leaving qualifiers out.
pub fn variants(r: &Rule) -> Vec<Rule> {
    let mut out = vec![*r];
    for q in QUALS {
        if has(r, q) {
            let more: Vec<Rule> = out.iter().map(|v| drop(v, q)).collect();
            out.extend(more);
        }
    }
    out
}

/// Is `general` the rule `special` with some (or no) qualifiers left out?
pub fn generalizes(general: &Rule, special: &Rule) -> bool {
    variants(special).contains(general)
}

const NONE: u8 = 0xFF;
/// Flag on a hit: the rule left other (suit-swapped) holds tied.
const ALT: u8 = 0x40;

/// How every rule in a pool applies to every hand class.
struct Table {
    pool: Vec<Rule>,
    /// `hits[class * pool.len() + rule]`: the hold mask, `| ALT` when the
    /// rule leaves alternatives, or `NONE`.
    hits: Vec<u8>,
    /// Alternatives (as a set of masks) for hits flagged `ALT`.
    alts: HashMap<(u32, u32), u32>,
    classes: usize,
}

impl Table {
    fn build(an: &Analyzer, pool: Vec<Rule>) -> Table {
        let hi = high_min(&an.game);
        let n = pool.len();
        let classes = an.classes.len();
        let mut hits = vec![NONE; classes * n];
        let fill = |start: usize, out: &mut [u8]| -> Vec<((u32, u32), u32)> {
            let mut alts = vec![];
            for (k, row) in out.chunks_mut(n).enumerate() {
                let c = start + k;
                let feats = subset_features(&an.game, &an.classes[c].cards, hi);
                for (i, r) in pool.iter().enumerate() {
                    if let RuleHit::Hold { mask, alternatives } = apply_rule(r, &feats) {
                        if alternatives.is_empty() {
                            row[i] = mask;
                        } else {
                            row[i] = mask | ALT;
                            let set = alternatives.iter().fold(0u32, |a, &m| a | 1 << m);
                            alts.push(((c as u32, i as u32), set));
                        }
                    }
                }
            }
            alts
        };
        let mut alts = HashMap::new();
        #[cfg(not(target_arch = "wasm32"))]
        {
            let threads = std::thread::available_parallelism()
                .map_or(1, |t| t.get())
                .min(16);
            let per = classes.div_ceil(threads).max(1);
            let parts: Vec<_> = std::thread::scope(|sc| {
                let handles: Vec<_> = hits
                    .chunks_mut(per * n.max(1))
                    .enumerate()
                    .map(|(t, chunk)| {
                        let fill = &fill;
                        sc.spawn(move || fill(t * per, chunk))
                    })
                    .collect();
                handles
                    .into_iter()
                    .map(|h| h.join().expect("simplify thread"))
                    .collect()
            });
            for p in parts {
                alts.extend(p);
            }
        }
        #[cfg(target_arch = "wasm32")]
        alts.extend(fill(0, &mut hits));
        Table {
            pool,
            hits,
            alts,
            classes,
        }
    }

    #[inline]
    fn hit(&self, c: usize, rule: u32) -> u8 {
        self.hits[c * self.pool.len() + rule as usize]
    }

    fn alts(&self, c: usize, rule: u32) -> u32 {
        if self.hit(c, rule) & ALT == 0 {
            0
        } else {
            self.alts[&(c as u32, rule)]
        }
    }

    /// The deciding position in `list` for class `c`, searching from `from`.
    #[inline]
    fn decide(&self, list: &[u32], c: usize, from: usize) -> usize {
        (from..list.len())
            .find(|&p| self.hit(c, list[p]) != NONE)
            .unwrap_or(list.len())
    }

    fn decisions(&self, list: &[u32]) -> Vec<usize> {
        (0..self.classes).map(|c| self.decide(list, c, 0)).collect()
    }

    /// Does `new` play every class exactly as `old` does (`dec`: old's
    /// deciding positions), without leaving a tie `old` didn't have?
    fn same_play(&self, old: &[u32], dec: &[usize], new: &[u32]) -> bool {
        let p = old.iter().zip(new).take_while(|(a, b)| a == b).count();
        (0..self.classes).all(|c| {
            let d = dec[c];
            if d < p {
                return true; // decided above every change
            }
            let e = self.decide(new, c, p);
            match (d < old.len(), e < new.len()) {
                (false, false) => true,
                (true, true) => {
                    let (a, b) = (old[d], new[e]);
                    let (ha, hb) = (self.hit(c, a), self.hit(c, b));
                    a == b
                        || (ha & !ALT == hb & !ALT && {
                            let (sa, sb) = (self.alts(c, a), self.alts(c, b));
                            sb & !sa == 0
                        })
                }
                _ => false,
            }
        })
    }

    /// Lines `super::compact` would write for this rule order.
    fn line_count(&self, list: &[u32]) -> usize {
        let n = list.len();
        let mut min_next = vec![usize::MAX; n];
        for c in 0..self.classes {
            let d = self.decide(list, c, 0);
            if d < n {
                let e = self.decide(list, c, d + 1);
                if e < n {
                    min_next[d] = min_next[d].min(e);
                }
            }
        }
        let mut lines = 0;
        let mut limit = 0usize;
        for i in 0..n {
            let alone = self.pool[list[i] as usize].pattern == Pattern::Nothing;
            if i > 0 && i < limit && !alone {
                limit = limit.min(min_next[i]);
            } else {
                lines += 1;
                limit = min_next[i];
            }
        }
        lines
    }
}

/// Candidate rule lists one simplification away from `list`.
fn candidates(pool: &[Rule], id: &HashMap<Rule, u32>, list: &[u32]) -> Vec<Vec<u32>> {
    let rule = |p: usize| pool[list[p] as usize];
    let last = list.len() - 1; // "discard everything" stays put
    let mut out: Vec<Vec<u32>> = vec![];
    let with = |p: usize, r: Rule| {
        let mut l = list.to_vec();
        l[p] = id[&r];
        l
    };
    // Drop one qualifier, or all of them.
    for p in 0..last {
        let r = rule(p);
        for q in QUALS.iter().filter(|&&q| has(&r, q)) {
            out.push(with(p, drop(&r, *q)));
        }
        if qualifiers(&r) > 1 {
            out.push(with(p, bare(&r)));
        }
    }
    // Collapse sibling runs: rules that differ only in one qualifier's value.
    for q in QUALS {
        let mut groups: Vec<(Rule, Vec<usize>)> = vec![];
        for p in 0..last {
            let r = rule(p);
            if !has(&r, q) {
                continue;
            }
            let key = drop(&r, q);
            match groups.iter_mut().find(|g| g.0 == key) {
                Some(g) => g.1.push(p),
                None => groups.push((key, vec![p])),
            }
        }
        for (key, ps) in groups.iter().filter(|g| g.1.len() > 1) {
            for a in 0..ps.len() {
                for b in a + 1..ps.len() {
                    let run = &ps[a..=b];
                    let mut to = vec![*key];
                    if bare(key) != *key {
                        to.push(bare(key));
                    }
                    for r in to {
                        for at in [run[0], run[run.len() - 1]] {
                            let l: Vec<u32> = (0..list.len())
                                .filter_map(|p| match p {
                                    p if p == at => Some(id[&r]),
                                    p if run.contains(&p) => None,
                                    p => Some(list[p]),
                                })
                                .collect();
                            out.push(l);
                        }
                    }
                }
            }
        }
    }
    // A rule that is another rule in the list with qualifiers added: remove
    // it, or move the plainer rule up into its place.
    for i in 0..last {
        for j in (0..last).filter(|&j| j != i) {
            if !generalizes(&rule(j), &rule(i)) {
                continue;
            }
            out.push([&list[..i], &list[i + 1..]].concat());
            if j > i {
                let mut l = list.to_vec();
                l[i] = list[j];
                l.remove(j);
                out.push(l);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// One fixpoint of simplifications on the rules in order (lines ignored).
fn reduce(an: &Analyzer, rules: &[Rule]) -> Vec<Rule> {
    let mut pool: Vec<Rule> = vec![];
    let mut id: HashMap<Rule, u32> = HashMap::new();
    for r in rules.iter().flat_map(variants) {
        if !id.contains_key(&r) {
            id.insert(r, pool.len() as u32);
            pool.push(r);
        }
    }
    let table = Table::build(an, pool);
    let quals: Vec<usize> = table.pool.iter().map(qualifiers).collect();
    let text: Vec<usize> = table.pool.iter().map(|r| r.to_string().len()).collect();
    let score = |l: &[u32]| -> (usize, usize) {
        l.iter().fold((0, 0), |(q, t), &r| {
            (q + quals[r as usize], t + text[r as usize])
        })
    };
    let mut list: Vec<u32> = rules.iter().map(|r| id[r]).collect();
    let limit = table.line_count(&list);
    let mut dec = table.decisions(&list);
    loop {
        let now = score(&list);
        let mut cands: Vec<((usize, usize), Vec<u32>)> = candidates(&table.pool, &id, &list)
            .into_iter()
            .map(|l| (score(&l), l))
            .filter(|(s, _)| *s < now)
            .collect();
        // Cheapest wording first; equal wordings keep a deterministic order.
        cands.sort();
        let mut best: Option<(usize, Vec<u32>)> = None;
        let mut best_score = None;
        for (s, l) in cands {
            if best_score.is_some_and(|b| s > b) {
                break;
            }
            if !table.same_play(&list, &dec, &l) {
                continue;
            }
            let lines = table.line_count(&l);
            if lines > limit || best.as_ref().is_some_and(|(bl, _)| lines >= *bl) {
                continue;
            }
            best_score = Some(s);
            best = Some((lines, l));
        }
        match best {
            Some((_, l)) => {
                list = l;
                dec = table.decisions(&list);
            }
            None => break,
        }
    }
    list.iter().map(|&r| table.pool[r as usize]).collect()
}

/// Drops later copies of a rule (an earlier copy always fires first).
fn dedupe(rules: Vec<Rule>) -> Vec<Rule> {
    let mut out: Vec<Rule> = Vec::with_capacity(rules.len());
    for r in rules {
        if !out.contains(&r) {
            out.push(r);
        }
    }
    out
}

/// The same strategy in the plainest wording found: every hand class gets
/// the identical hold, and the list needs no more lines than before. The
/// result is compacted into lines (`super::compact`) and is a fixpoint:
/// simplifying it again changes nothing.
pub fn simplify(an: &Analyzer, strategy: &Strategy) -> Strategy {
    let mut cur = strategy.clone();
    for _ in 0..8 {
        let next = super::compact(an, &Strategy::new(dedupe(reduce(an, &cur.rules))));
        if next == cur {
            break;
        }
        cur = next;
    }
    cur
}

/// For each rule of `old`, the rule of `new` that now decides most of the
/// hands it decided (by deals), or None if it decided none. For carrying
/// per-rule stats over to a simplified list.
pub fn rule_map(an: &Analyzer, old: &Strategy, new: &Strategy) -> Vec<Option<usize>> {
    let hi = high_min(&an.game);
    let mut w: HashMap<(usize, usize), u64> = HashMap::new();
    for cl in &an.classes {
        let feats = subset_features(&an.game, &cl.cards, hi);
        let a = super::evaluate::play_features(old, &feats).rule;
        let b = super::evaluate::play_features(new, &feats).rule;
        if let (Some(a), Some(b)) = (a, b) {
            *w.entry((a, b)).or_default() += cl.weight as u64;
        }
    }
    (0..old.rules.len())
        .map(|a| {
            (0..new.rules.len())
                .filter_map(|b| w.get(&(a, b)).map(|&x| (x, std::cmp::Reverse(b))))
                .max()
                .map(|(_, std::cmp::Reverse(b))| b)
        })
        .collect()
}

/// Qualifiers in a list (what simplification removes).
pub fn count_qualifiers(s: &Strategy) -> usize {
    s.rules.iter().map(qualifiers).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variants_and_drops() {
        let r: Rule = "3 to a straight flush w=2 h=1 fp=0".parse().unwrap();
        assert_eq!(qualifiers(&r), 3);
        assert_eq!(variants(&r).len(), 8);
        assert_eq!(bare(&r).to_string(), "3 to a straight flush");
        assert_eq!(
            drop(&r, Qual::H).to_string(),
            "3 to a straight flush w=2 fp=0"
        );
        let p: Rule = "pair J-A".parse().unwrap();
        assert_eq!(drop(&p, Qual::Ranks).to_string(), "pair");
        let t: Rule = "three of a kind A kicker 2-4".parse().unwrap();
        assert_eq!(
            drop(&t, Qual::Ranks).to_string(),
            "three of a kind kicker 2-4"
        );
        assert_eq!(
            drop(&t, Qual::Ranks).to_string().parse::<Rule>().unwrap(),
            drop(&t, Qual::Ranks)
        );
        let h: Rule = "2 high cards suited prefer low".parse().unwrap();
        assert_eq!(bare(&h).to_string(), "2 high cards");
        // Exact card rules keep their suitedness: it is part of the name.
        let e: Rule = "KQJ unsuited".parse().unwrap();
        assert_eq!(qualifiers(&e), 0);
        assert!(generalizes(
            &"4 to a flush".parse().unwrap(),
            &"4 to a flush h=2".parse().unwrap()
        ));
        assert!(!generalizes(
            &"4 to a flush h=1".parse().unwrap(),
            &"4 to a flush h=2".parse().unwrap()
        ));
    }
}
