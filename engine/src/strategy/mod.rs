//! Strategy layer (SPEC §4): rule language, evaluator, generator.

pub mod evaluate;
pub mod features;
pub mod generate;
pub mod rule;

pub use evaluate::{Play, Report, evaluate, matching_rules, play};
pub use generate::{TIERS, Tier, generate, generate_tiers, tier};
pub use rule::{Rule, Strategy};

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
