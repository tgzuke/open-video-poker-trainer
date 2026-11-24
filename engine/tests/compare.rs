//! Milestone 7: pay table comparison (SPEC §4.5).

use ovp_engine::analysis::{Analyzer, Ratio};
use ovp_engine::combin::for_each_combination;
use ovp_engine::game::{Game, builtin_game, builtin_paytable};
use ovp_engine::strategy::compare::{edit_steps, normalize};
use ovp_engine::strategy::rule::Pattern;
use ovp_engine::strategy::{self, ChangeKind, Strategy};
use ovp_engine::verify;
use std::collections::HashSet;

fn shipped(table: &str, tier: &str) -> Strategy {
    let path = format!("{}/../strategies/{table}/{tier}.txt", env!("CARGO_MANIFEST_DIR"));
    Strategy::parse(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

fn setup(table: &str) -> (Analyzer, Vec<i64>) {
    let t = builtin_paytable(table).unwrap();
    let g = builtin_game(&t.game).unwrap();
    let pays = g.pays_for_bet(&t, 5).unwrap();
    (Analyzer::new(g), pays)
}

fn strategy_of(pool: &[ovp_engine::strategy::Rule], state: &[usize]) -> Strategy {
    Strategy::new(state.iter().map(|&k| pool[k]).collect())
}

/// Every step list ends at B, every intermediate list is a valid strategy,
/// and the change kinds match the set differences.
fn check_steps(a: &Strategy, b: &Strategy) {
    let (pool, changes, states) = edit_steps(a, b);
    assert_eq!(states.len(), changes.len() + 1);
    assert_eq!(strategy_of(&pool, &states[0]), *a);
    assert_eq!(strategy_of(&pool, states.last().unwrap()), *b);
    for st in &states {
        let s = strategy_of(&pool, st);
        assert_eq!(s.rules.last().unwrap().pattern, Pattern::Nothing);
        Strategy::parse(&s.to_text()).expect("intermediate list must be valid");
    }
    let removed: HashSet<_> = a.rules.iter().filter(|r| !b.rules.contains(r)).collect();
    let added: HashSet<_> = b.rules.iter().filter(|r| !a.rules.contains(r)).collect();
    for c in &changes {
        match c.kind {
            ChangeKind::Removed => {
                assert!(removed.contains(&c.rule));
                assert_eq!(a.rules[c.from.unwrap()], c.rule);
            }
            ChangeKind::Added => {
                assert!(added.contains(&c.rule));
                assert_eq!(b.rules[c.to.unwrap()], c.rule);
            }
            ChangeKind::Moved => {
                assert_eq!(a.rules[c.from.unwrap()], c.rule);
                assert_eq!(b.rules[c.to.unwrap()], c.rule);
            }
        }
    }
    let count = |k| changes.iter().filter(|c| c.kind == k).count();
    assert_eq!(count(ChangeKind::Removed), removed.len());
    assert_eq!(count(ChangeKind::Added), added.len());
}

/// Edit steps on many shuffled, trimmed and extended lists drawn from the
/// shipped rules (no engine needed).
#[test]
fn edit_steps_always_reach_b() {
    let mut pool: Vec<_> = ["expert", "intermediate", "beginner"]
        .iter()
        .flat_map(|t| normalize(&shipped("double-double-bonus-9-6", t)).rules)
        .filter(|r| r.pattern != Pattern::Nothing)
        .collect();
    pool.dedup();
    let pool = normalize(&Strategy::new(pool)).rules;
    let discard = Strategy::parse("discard everything").unwrap().rules[0];
    let mut seed = 0x9e3779b97f4a7c15u64;
    let mut rnd = |n: usize| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed % n as u64) as usize
    };
    let random_list = |rnd: &mut dyn FnMut(usize) -> usize| {
        let mut v = pool.clone();
        for i in (1..v.len()).rev() {
            v.swap(i, rnd(i + 1));
        }
        v.truncate(rnd(pool.len()));
        v.push(discard);
        Strategy::new(v)
    };
    for _ in 0..500 {
        let a = random_list(&mut rnd);
        let b = random_list(&mut rnd);
        check_steps(&a, &b);
        check_steps(&b, &a);
        check_steps(&a, &a);
    }
}

#[test]
fn same_strategy_has_no_changes() {
    let (an, pays) = setup("jacks-or-better-9-6");
    let s = shipped("jacks-or-better-9-6", "intermediate");
    let c = strategy::compare(&an, &pays, 5, &s, &s);
    assert!(c.changes.is_empty());
    assert!(c.differences.is_empty());
    assert_eq!(c.differ, 0.0);
    assert_eq!(c.a_on_b, c.b_on_b);
}

#[test]
fn split_pat_lines_keeps_play() {
    let (an, pays) = setup("double-double-bonus-9-6");
    for tier in ["beginner", "intermediate", "expert"] {
        let s = shipped("double-double-bonus-9-6", tier);
        let split = strategy::split_pat_lines(&s);
        assert!(split.rules.iter().all(|r| !matches!(r.pattern, Pattern::Pat(_))));
        let (r0, r1) = (
            strategy::evaluate(&an, &pays, 5, &s),
            strategy::evaluate(&an, &pays, 5, &split),
        );
        assert_eq!(r0.holds, r1.holds, "{tier}");
        assert_eq!(r0.ret, r1.ret);
    }
}

/// Full-deck comparisons of shipped strategies: the endpoints are the exact
/// evaluator's returns, the per-change effects add up to the difference, and
/// so do the per-group effects of the hands played differently.
#[test]
fn comparison_adds_up() {
    let cases = [
        ("jacks-or-better-9-6", "jacks-or-better-8-5", "beginner", "beginner"),
        ("jacks-or-better-9-6", "jacks-or-better-8-5", "intermediate", "intermediate"),
        ("double-bonus-10-7", "double-bonus-9-6-4", "expert", "expert"),
        ("double-double-bonus-9-6", "double-double-bonus-9-6", "beginner", "expert"),
    ];
    for (ta, tb, tier_a, tier_b) in cases {
        let (an, pays) = setup(tb);
        let (a, b) = (shipped(ta, tier_a), shipped(tb, tier_b));
        let c = strategy::compare(&an, &pays, 5, &a, &b);
        let ra = strategy::evaluate(&an, &pays, 5, &a);
        let rb = strategy::evaluate(&an, &pays, 5, &b);
        assert_eq!(c.a_on_b, ra.ret, "{ta} {tier_a} on {tb}");
        assert_eq!(c.b_on_b, rb.ret);
        assert_eq!(c.optimal_b, rb.optimal);
        let total = c.b_on_b.to_f64() - c.a_on_b.to_f64();
        let sum: f64 = c.changes.iter().map(|ch| ch.delta).sum();
        assert!((sum - total).abs() < 1e-12, "{sum} vs {total}");
        let effects: f64 = c.differences.iter().map(|d| d.effect).sum();
        assert!((effects - total * 5.0).abs() < 1e-11, "{effects} vs {}", total * 5.0);
        let p: f64 = c.differences.iter().map(|d| d.prob).sum();
        assert!((p - c.differ).abs() < 1e-12);
        assert!(c.differ > 0.0 && c.differ < 1.0);
        for d in &c.differences {
            assert_ne!(d.a_hold, d.b_hold);
            assert!(d.gain != 0.0);
        }
        check_steps(&normalize(&a), &normalize(&b));
    }
}

/// Return of a strategy played on every deal (no symmetry, no tables
/// shared with the comparison's class loop beyond the draw counts).
fn every_deal_return(game: &Game, an: &Analyzer, pays: &[i64], bet: u32, s: &Strategy) -> Ratio {
    let all: Vec<u8> = (0..game.deck().size() as u8).collect();
    let mut acc = Ratio::from_int(0);
    let mut deals = 0i128;
    for_each_combination(&all, 5, |h| {
        let h = [h[0], h[1], h[2], h[3], h[4]];
        let m = strategy::play(game, s, &h).hold as usize;
        let evs = an.hold_evs(&h, pays);
        acc = acc.add(Ratio::new(evs.numer[m] as i128, evs.draws[m] as i128));
        deals += 1;
    });
    acc.mul(Ratio::new(1, deals * bet as i128))
}

/// On reduced decks, each change's effect equals the difference between
/// the lists before and after it, each played on every single deal.
#[test]
fn change_effects_match_every_deal_play() {
    let base = builtin_game("double-double-bonus").unwrap();
    let t = builtin_paytable("double-double-bonus-9-6").unwrap();
    let pays = base.pays_for_bet(&t, 5).unwrap();
    let a = normalize(&shipped("double-double-bonus-9-6", "beginner"));
    let b = normalize(&shipped("double-double-bonus-6-5", "intermediate"));
    let (pool, changes, states) = edit_steps(&a, &b);
    assert!(changes.len() > 10);
    for g in verify::reduced_games(&base).into_iter().take(2) {
        let an = Analyzer::new(g.clone());
        let c = strategy::compare(&an, &pays, 5, &a, &b);
        let rets: Vec<f64> = states
            .iter()
            .map(|st| every_deal_return(&g, &an, &pays, 5, &strategy_of(&pool, st)).to_f64())
            .collect();
        assert_eq!(c.changes.len(), changes.len());
        for (i, ch) in c.changes.iter().enumerate() {
            let want = rets[i + 1] - rets[i];
            assert!((ch.delta - want).abs() < 1e-12, "deck {} change {i}: {} vs {want}", g.deck().size(), ch.delta);
        }
        assert_eq!(c.b_on_b, every_deal_return(&g, &an, &pays, 5, &b));
        assert_eq!(c.a_on_b, every_deal_return(&g, &an, &pays, 5, &a));
    }
}
