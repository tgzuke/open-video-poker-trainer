//! Strategy layer (SPEC §4): rule language, evaluator, generator.

pub mod compare;
pub mod evaluate;
pub mod features;
pub mod generate;
pub mod rule;
pub mod simplify;
pub mod trainer;

pub use compare::{Change, ChangeKind, Comparison, compare};
pub use evaluate::{Play, Report, evaluate, matching_rules, play};
pub use generate::{MAX_LINES, MIN_LINES, TIERS, Tier, generate, generate_tiers, tier};
pub use rule::{Rule, Strategy};
pub use simplify::simplify;
pub use trainer::{DealCheck, deal_check};

/// The single-hand rule for one pat-hand bit of `Pattern::Pat`.
pub(crate) fn single_pat(bit: u32) -> rule::Pattern {
    use crate::eval::HandKind;
    use rule::{ALL_RANKS, Pattern};
    match bit {
        0 => Pattern::Made(HandKind::RoyalFlush),
        1 => Pattern::Made(HandKind::StraightFlush),
        2 => Pattern::Quads {
            ranks: ALL_RANKS,
            kicker: None,
        },
        3 => Pattern::Made(HandKind::FullHouse),
        4 => Pattern::Made(HandKind::Flush),
        _ => Pattern::Made(HandKind::Straight),
    }
}

/// Writes every rule on its own line, and each combined pat-hand rule as one
/// line per hand, in the same place. Play is unchanged: a dealt hand is only
/// one kind of pat hand.
pub fn split_pat_lines(strategy: &Strategy) -> Strategy {
    let mut rules = Vec::with_capacity(strategy.rules.len());
    for r in &strategy.rules {
        match r.pattern {
            rule::Pattern::Pat(m) => {
                for bit in (0..6).filter(|b| m >> b & 1 == 1) {
                    rules.push(Rule {
                        pattern: single_pat(bit),
                        ..*r
                    });
                }
            }
            _ => rules.push(*r),
        }
    }
    Strategy::new(rules)
}

/// Removes pat hands from a combined pat line when an earlier unqualified
/// line already keeps that hand (the bit could never fire). Play is
/// unchanged; a line left with one pat hand becomes that single rule.
pub fn tidy(strategy: &Strategy) -> Strategy {
    use rule::{ALL_RANKS, Pattern, pat_bit};
    let mut covered = 0u8;
    let mut rules = Vec::with_capacity(strategy.rules.len());
    let mut joined = Vec::with_capacity(strategy.rules.len());
    // A dropped rule that started its line hands the start to the next one.
    let mut starts_line = false;
    for (i, r) in strategy.rules.iter().enumerate() {
        let mut r = *r;
        let j = strategy.joined.get(i).copied().unwrap_or(false);
        if let Pattern::Pat(m) = r.pattern {
            let left = m & !covered;
            if left == 0 {
                starts_line |= !j;
                continue; // nothing reachable: drop the rule
            }
            r.pattern = if left.count_ones() == 1 {
                single_pat(left.trailing_zeros())
            } else {
                Pattern::Pat(left)
            };
        }
        if !r.has_qualifier() {
            covered |= match r.pattern {
                Pattern::Pat(m) => m,
                Pattern::Made(k) => pat_bit(k).map_or(0, |b| 1 << b),
                Pattern::Quads {
                    ranks: ALL_RANKS,
                    kicker: None,
                } => 1 << 2,
                _ => 0,
            };
        }
        rules.push(r);
        joined.push(j && !starts_line && !rules.is_empty() && rules.len() > 1);
        starts_line = false;
    }
    Strategy { rules, joined }
}

/// Header metadata for a strategy file.
pub struct FileMeta<'a> {
    pub game: &'a str,
    pub paytable: &'a str,
    pub bet: u32,
    pub progressive: Option<i64>,
    pub tier: Option<&'a Tier>,
}

/// Strategy file text: metadata and results as `#` comments, one written
/// line per line with its own numbers as a trailing comment. Parses back unchanged.
pub fn render_file(strategy: &Strategy, report: &Report, meta: &FileMeta) -> String {
    let mut s = String::new();
    s.push_str(
        "# Open Video Poker Trainer strategy (generated; notation: docs/strategy-format.md)\n",
    );
    s.push_str(&format!(
        "# game: {}\n# paytable: {}\n# bet: {}\n",
        meta.game, meta.paytable, meta.bet
    ));
    if let Some(p) = meta.progressive {
        s.push_str(&format!("# progressive: {p}\n"));
    }
    if let Some(t) = meta.tier {
        s.push_str(&format!("# tier: {} (max {} lines)\n", t.name, t.max_lines));
    }
    s.push_str(&format!(
        "# return: {:.6}%  optimal: {:.6}%\n# loss: {:.6} credits/hand ({:.6} points of return)\n",
        report.ret.to_f64() * 100.0,
        report.optimal.to_f64() * 100.0,
        report.loss_credits(),
        report.loss_points()
    ));
    s.push_str(&format!(
        "# complete: {}\n#\n# per rule: how often it decides the hand, how often its hold is not optimal, EV lost (credits/hand)\n",
        if report.is_complete() { "yes" } else { "NO" }
    ));
    let lines = strategy.line_texts();
    let width = lines.iter().map(|l| l.len()).max().unwrap_or(0).max(20);
    for (l, st) in lines.iter().zip(&report.rules) {
        s.push_str(&format!(
            "{:<width$}  # fires {:>8.4}%  wrong {:>8.4}%  loss {:.6}\n",
            l,
            st.fires * 100.0,
            st.disagrees * 100.0,
            st.loss
        ));
    }
    s
}

/// Reorders rules for reading without changing play. Two neighbouring rules
/// can be swapped freely unless some hand decided by one of them is also
/// matched by the other (e.g. a full house matches both "three of a kind"
/// and "pair J-A", but an earlier pat line decides it). Among such rules, the one whose
/// holds are worth more on average goes first, so e.g. "three of a kind"
/// reads above "pair J-A" even though they never compete.
pub fn natural_order(
    an: &crate::analysis::Analyzer,
    pays: &[i64],
    strategy: &Strategy,
) -> Strategy {
    use features::{RuleHit, apply_rule, high_min, subset_features};
    let n = strategy.rules.len();
    let hi = high_min(&an.game);
    // conflict[a][b]: some hand matches both rules.
    let mut conflict = vec![vec![false; n]; n];
    let mut ev_sum = vec![0.0f64; n];
    let mut w_sum = vec![0.0f64; n];
    let mut hits = Vec::with_capacity(n);
    for cl in &an.classes {
        let feats = subset_features(&an.game, &cl.cards, hi);
        hits.clear();
        let mut fired: Option<(usize, u8)> = None;
        for (i, r) in strategy.rules.iter().enumerate() {
            if let RuleHit::Hold { mask, .. } = apply_rule(r, &feats) {
                hits.push(i);
                fired.get_or_insert((i, mask));
            }
        }
        // Only the deciding rule matters: swapping two adjacent rules changes
        // this hand only if one of them decides it and the other matches too.
        // Safe swaps never change any hand's deciding rule, so this stays
        // valid throughout the sort.
        if let Some(&f) = hits.first() {
            for &b in &hits[1..] {
                conflict[f][b] = true;
                conflict[b][f] = true;
            }
        }
        if let Some((i, m)) = fired {
            let evs = an.hold_evs(&cl.cards, pays);
            ev_sum[i] += cl.weight as f64 * evs.ev(m as usize);
            w_sum[i] += cl.weight as f64;
        }
    }
    let key: Vec<f64> = (0..n)
        .map(|i| {
            if w_sum[i] > 0.0 {
                ev_sum[i] / w_sum[i]
            } else {
                f64::NEG_INFINITY
            }
        })
        .collect();
    let mut order: Vec<usize> = (0..n).collect();
    // Bubble sort restricted to swaps of non-conflicting neighbours.
    loop {
        let mut swapped = false;
        for i in 0..n.saturating_sub(1) {
            let (a, b) = (order[i], order[i + 1]);
            if !conflict[a][b] && key[b] > key[a] + 1e-12 {
                order.swap(i, i + 1);
                swapped = true;
            }
        }
        if !swapped {
            break;
        }
    }
    Strategy::new(order.into_iter().map(|i| strategy.rules[i]).collect())
}

/// Rewrites the list with adjacent rules joined on one line wherever no
/// hand that reaches the line matches two of its rules. Such rules never
/// compete, so they can be read in any order, and the line counts once
/// toward a tier's line cap. Play is unchanged (the rules keep their order);
/// for a fixed order the greedy grouping gives the fewest lines.
/// "discard everything" always stays on its own line.
pub fn compact(an: &crate::analysis::Analyzer, strategy: &Strategy) -> Strategy {
    use features::{RuleHit, apply_rule, high_min, subset_features};
    let n = strategy.rules.len();
    let hi = high_min(&an.game);
    // min_next[d]: the earliest rule after d that also matches a hand d
    // decides. A line holding d may not reach it.
    let mut min_next = vec![usize::MAX; n];
    for cl in &an.classes {
        let feats = subset_features(&an.game, &cl.cards, hi);
        let mut decided: Option<usize> = None;
        for (i, r) in strategy.rules.iter().enumerate() {
            if let RuleHit::Hold { .. } = apply_rule(r, &feats) {
                match decided {
                    None => decided = Some(i),
                    Some(d) => {
                        min_next[d] = min_next[d].min(i);
                        break;
                    }
                }
            }
        }
    }
    let mut joined = vec![false; n];
    let mut limit = 0usize;
    for i in 0..n {
        let alone = strategy.rules[i].pattern == rule::Pattern::Nothing;
        if i > 0 && i < limit && !alone {
            joined[i] = true;
            limit = limit.min(min_next[i]);
        } else {
            limit = min_next[i];
        }
    }
    // No hand reaching a line matches two of its rules, so they may be
    // written in any order: pat hands first, as one combined rule.
    let grouped = Strategy {
        rules: strategy.rules.clone(),
        joined,
    };
    Strategy::from_lines(
        grouped
            .lines()
            .into_iter()
            .map(|range| {
                let mut line = grouped.rules[range].to_vec();
                line.sort_by_key(|r| rule::pat_mask(r).is_none());
                rule::merge_pat_runs(line)
            })
            .collect(),
    )
}
