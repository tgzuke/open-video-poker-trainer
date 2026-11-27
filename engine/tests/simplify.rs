//! Strategy simplification: plainer wording, identical play.
//!
//! `tests/data/pre-simplify/` holds the shipped lists as they were before
//! the simplification pass; `strategies/` holds them after. Every check
//! that play is unchanged is exact, over every hand class.

use ovp_engine::analysis::Analyzer;
use ovp_engine::game::{builtin_game, builtin_paytables};
use ovp_engine::strategy::features::{RuleHit, apply_rule, high_min, subset_features};
use ovp_engine::strategy::rule::{Pattern, Rule};
use ovp_engine::strategy::simplify::{
    QUALS, bare, count_qualifiers, drop, has, rule_map, simplify,
};
use ovp_engine::strategy::{self, Strategy, TIERS};

fn read(path: &str) -> Strategy {
    let full = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
    Strategy::parse(&std::fs::read_to_string(&full).unwrap_or_else(|e| panic!("{full}: {e}")))
        .unwrap()
}

fn shipped(table: &str, tier: &str) -> Strategy {
    read(&format!("../strategies/{table}/{tier}.txt"))
}

fn original(table: &str, tier: &str) -> Strategy {
    read(&format!("tests/data/pre-simplify/{table}/{tier}.txt"))
}

/// The owner's example: BP 6/5 beginner's
///   `3 to a royal h=2` / `3 to a royal, 4 to a flush h=2, h=1, h=0`
/// reads `3 to a royal` / `4 to a flush`, and every class keeps its hold.
#[test]
fn bonus_poker_6_5_beginner_example() {
    let an = Analyzer::new(builtin_game("bonus-poker").unwrap());
    let table = ovp_engine::game::builtin_paytable("bonus-poker-6-5").unwrap();
    let pays = an.game.pays_for_bet(&table, 5).unwrap();
    let old = original("bonus-poker-6-5", "beginner");
    let texts = old.line_texts();
    assert!(texts.contains(&"3 to a royal h=2".to_string()));
    assert!(texts.contains(
        &"3 to a royal, 4 to a flush h=2, 4 to a flush h=1, 4 to a flush h=0".to_string()
    ));
    let new = simplify(&an, &old);
    let lines = new.line_texts();
    let at = lines
        .iter()
        .position(|l| l == "3 to a royal")
        .expect("a '3 to a royal' line");
    assert_eq!(lines[at + 1], "4 to a flush");
    assert!(
        !lines
            .iter()
            .any(|l| l.contains("to a royal h=") || l.contains("to a flush h="))
    );
    let a = strategy::evaluate(&an, &pays, 5, &old);
    let b = strategy::evaluate(&an, &pays, 5, &new);
    assert_eq!(a.holds, b.holds);
    assert_eq!(a.ret, b.ret);
    assert!(b.is_complete());
}

/// A qualifier that never matters is dropped, and one that does is kept.
#[test]
fn keeps_qualifiers_that_matter() {
    let an = Analyzer::new(builtin_game("jacks-or-better").unwrap());
    // h=2 on "3 to a royal" with nothing else about royals: the h=3 ones
    // would then fall to "pair"/"discard", so h=2 matters and stays.
    let s = Strategy::parse("royal flush\n3 to a royal h=2\npair\ndiscard everything\n").unwrap();
    assert_eq!(simplify(&an, &s), strategy::compact(&an, &s));
    // "pair J-A" then "pair 2-T": together just "pair".
    let s = Strategy::parse("pair J-A\npair 2-T\ndiscard everything\n").unwrap();
    assert_eq!(simplify(&an, &s).to_text(), "pair\ndiscard everything\n");
    // A rule below an identical one never fires.
    let s = Strategy::parse("pair\n4 to a flush\npair\ndiscard everything\n").unwrap();
    assert_eq!(simplify(&an, &s).rules.len(), 3);
}

/// Hold of every class, computed straight from the rule matcher.
struct Hits {
    rules: Vec<Rule>,
    /// hits[class][rule]: hold mask or 255.
    hits: Vec<Vec<u8>>,
}

impl Hits {
    fn new(an: &Analyzer, rules: Vec<Rule>) -> Hits {
        let hi = high_min(&an.game);
        let hits = an
            .classes
            .iter()
            .map(|cl| {
                let f = subset_features(&an.game, &cl.cards, hi);
                rules
                    .iter()
                    .map(|r| match apply_rule(r, &f) {
                        RuleHit::Hold { mask, .. } => mask,
                        RuleHit::NoMatch => 255,
                    })
                    .collect()
            })
            .collect();
        Hits { rules, hits }
    }
    fn holds(&self, list: &[Rule]) -> Vec<u8> {
        let ids: Vec<usize> = list
            .iter()
            .map(|r| self.rules.iter().position(|x| x == r).unwrap())
            .collect();
        self.hits
            .iter()
            .map(|h| ids.iter().map(|&i| h[i]).find(|&m| m != 255).unwrap_or(255))
            .collect()
    }
}

/// Every single simplification of `s` that a reader might expect:
/// drop a qualifier, collapse a run of siblings, merge a rule into a
/// plainer copy of itself further down.
fn one_step_rewrites(s: &Strategy) -> Vec<(String, Vec<Rule>)> {
    let r = &s.rules;
    let last = r.len() - 1;
    let mut out = vec![];
    for i in 0..last {
        for q in QUALS.iter().filter(|&&q| has(&r[i], q)) {
            let mut l = r.clone();
            l[i] = drop(&r[i], *q);
            out.push((format!("drop {q:?} from '{}'", r[i]), l));
        }
    }
    for q in QUALS {
        for i in 0..last {
            if !has(&r[i], q) {
                continue;
            }
            let key = drop(&r[i], q);
            let sibs: Vec<usize> = (i..last)
                .filter(|&j| has(&r[j], q) && drop(&r[j], q) == key)
                .collect();
            for end in 1..sibs.len() {
                let run = &sibs[..=end];
                for to in [key, bare(&key)] {
                    let l: Vec<Rule> = (0..r.len())
                        .filter_map(|p| match p {
                            p if p == run[0] => Some(to),
                            p if run.contains(&p) => None,
                            p => Some(r[p]),
                        })
                        .collect();
                    out.push((
                        format!("collapse {} siblings of '{key}' into '{to}'", run.len()),
                        l,
                    ));
                }
            }
        }
    }
    for i in 0..last {
        for j in i + 1..last {
            if bare(&r[i]) == bare(&r[j])
                && r[j] != r[i]
                && ovp_engine::strategy::simplify::generalizes(&r[j], &r[i])
            {
                let mut l = r.clone();
                l.remove(i);
                out.push((format!("merge '{}' into '{}' below", r[i], r[j]), l));
            }
        }
    }
    out
}

/// All 60 shipped lists, against the pre-simplification originals.
fn check_game(gid: &str) {
    let an = Analyzer::new(builtin_game(gid).unwrap());
    for table in builtin_paytables().into_iter().filter(|t| t.game == gid) {
        let pays = an.game.pays_for_bet(&table, an.game.def.max_bet).unwrap();
        let bet = an.game.def.max_bet;
        for tier in TIERS {
            let what = format!("{} {}", table.id, tier.name);
            let old = original(&table.id, tier.name);
            let new = shipped(&table.id, tier.name);
            // The shipped list is exactly what the pass makes of the original.
            let made = simplify(&an, &old);
            assert_eq!(made, new, "{what}: shipped list is not simplify(original)");
            // Identical play and numbers.
            let a = strategy::evaluate(&an, &pays, bet, &old);
            let b = strategy::evaluate(&an, &pays, bet, &new);
            assert_eq!(a.holds, b.holds, "{what}: a hold changed");
            assert_eq!(a.ret, b.ret, "{what}: return changed");
            assert_eq!(a.optimal, b.optimal);
            assert!(b.is_complete(), "{what}: incomplete");
            // Never longer, within the cap; never more qualifiers.
            assert!(new.line_count() <= old.line_count(), "{what}: more lines");
            assert!(new.line_count() <= tier.max_lines, "{what}: over the cap");
            assert!(count_qualifiers(&new) <= count_qualifiers(&old));
            // Merged-line invariant: no hand reaching a line matches two of its rules.
            let line_of = new.line_of();
            for cl in &an.classes {
                let m = strategy::matching_rules(&an.game, &new, &cl.cards);
                let d = m[0].0;
                assert!(
                    !m[1..].iter().any(|&(i, _)| line_of[i] == line_of[d]),
                    "{what}: {} matches two rules of one line",
                    an.game.deck().hand_name(&cl.cards)
                );
            }
            // Idempotent, and the text round-trips.
            assert_eq!(simplify(&an, &new), new, "{what}: not idempotent");
            assert_eq!(
                Strategy::parse(&new.to_text()).unwrap(),
                new,
                "{what}: round trip"
            );
            // Nothing redundant is left: each one-step rewrite changes some
            // hold, needs more lines, or leaves a rule with an unresolved tie.
            let mut pool: Vec<Rule> = new.rules.clone();
            let rewrites = one_step_rewrites(&new);
            for (_, l) in &rewrites {
                for r in l {
                    if !pool.contains(r) {
                        pool.push(*r);
                    }
                }
            }
            let hits = Hits::new(&an, pool);
            let base = hits.holds(&new.rules);
            assert_eq!(base, b.holds);
            for (how, l) in rewrites {
                if hits.holds(&l) != base {
                    continue;
                }
                let cand = strategy::compact(&an, &Strategy::new(l));
                let r = strategy::evaluate(&an, &pays, bet, &cand);
                assert!(
                    cand.line_count() > new.line_count() || !r.is_complete(),
                    "{what}: redundant wording left: {how}"
                );
            }
        }
    }
}

#[test]
fn shipped_simplified_jacks_or_better() {
    check_game("jacks-or-better");
}
#[test]
fn shipped_simplified_bonus_poker() {
    check_game("bonus-poker");
}
#[test]
fn shipped_simplified_double_bonus() {
    check_game("double-bonus");
}
#[test]
fn shipped_simplified_double_double_bonus() {
    check_game("double-double-bonus");
}

/// The stats migration table maps every renamed rule of a shipped list to a
/// rule of the current list, and agrees with `rule_map`.
#[test]
fn rename_table_points_at_current_rules() {
    let path = format!(
        "{}/../strategies/rule-renames.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let doc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let lists = doc["lists"].as_object().unwrap();
    for (key, map) in lists {
        let (table, tier) = key.split_once('/').unwrap();
        let rules: Vec<String> = shipped(table, tier)
            .rules
            .iter()
            .map(|r| r.to_string())
            .collect();
        for (from, to) in map.as_object().unwrap() {
            let to = to.as_str().unwrap();
            assert!(
                rules.iter().any(|r| r == to),
                "{key}: '{from}' -> '{to}', not a rule of the list"
            );
            assert!(
                !rules.iter().any(|r| r == from),
                "{key}: '{from}' is still a rule of the list"
            );
        }
    }
    // Spot check the owner's example.
    let bp = lists["bonus-poker-6-5/beginner"].as_object().unwrap();
    assert_eq!(bp["3 to a royal h=2"], "3 to a royal");
    assert_eq!(bp["4 to a flush h=1"], "4 to a flush");
    // rule_map on the example agrees.
    let an = Analyzer::new(builtin_game("bonus-poker").unwrap());
    let (old, new) = (
        original("bonus-poker-6-5", "beginner"),
        shipped("bonus-poker-6-5", "beginner"),
    );
    let map = rule_map(&an, &old, &new);
    for (i, m) in map.iter().enumerate() {
        let (from, to) = (old.rules[i].to_string(), new.rules[m.unwrap()].to_string());
        if from != to {
            assert_eq!(bp[&from], to.as_str(), "{from}");
        }
    }
    let _ = Pattern::Nothing;
}
