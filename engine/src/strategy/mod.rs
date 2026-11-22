//! Strategy layer (SPEC §4): rule language, evaluator, generator.

pub mod evaluate;
pub mod features;
pub mod generate;
pub mod rule;
pub mod trainer;

pub use evaluate::{Play, Report, evaluate, matching_rules, play};
pub use generate::{MAX_LINES, MIN_LINES, TIERS, Tier, generate, generate_tiers, tier};
pub use rule::{Rule, Strategy};
pub use trainer::{DealCheck, deal_check};

/// Removes pat hands from a combined pat line when an earlier unqualified
/// line already keeps that hand (the bit could never fire). Play is
/// unchanged; a line left with one pat hand becomes that single rule.
pub fn tidy(strategy: &Strategy) -> Strategy {
    use crate::eval::HandKind;
    use rule::{ALL_RANKS, Pattern, pat_bit};
    let mut covered = 0u8;
    let mut rules = Vec::with_capacity(strategy.rules.len());
    for r in &strategy.rules {
        let mut r = *r;
        if let Pattern::Pat(m) = r.pattern {
            let left = m & !covered;
            if left == 0 {
                continue; // nothing reachable: drop the line
            }
            r.pattern = if left.count_ones() == 1 {
                match left.trailing_zeros() {
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
    }
    Strategy { rules }
}

/// Header metadata for a strategy file.
pub struct FileMeta<'a> {
    pub game: &'a str,
    pub paytable: &'a str,
    pub bet: u32,
    pub progressive: Option<i64>,
    pub tier: Option<&'a Tier>,
}

/// Strategy file text: metadata and results as `#` comments, one rule per
/// line with its own numbers as a trailing comment. Parses back unchanged.
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
    let width = strategy
        .rules
        .iter()
        .map(|r| r.to_string().len())
        .max()
        .unwrap_or(0)
        .max(20);
    for (r, st) in strategy.rules.iter().zip(&report.rules) {
        s.push_str(&format!(
            "{:<width$}  # fires {:>8.4}%  wrong {:>8.4}%  loss {:.6}\n",
            r.to_string(),
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
    Strategy {
        rules: order.into_iter().map(|i| strategy.rules[i]).collect(),
    }
}
