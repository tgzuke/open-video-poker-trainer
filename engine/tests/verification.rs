//! SPEC §3.3 verification suite. Every check here must pass for Milestone 1.

use ovp_engine::analysis::{Analyzer, canonical_classes};
use ovp_engine::game::{Game, builtin_game, builtin_paytable};
use ovp_engine::verify;

fn job() -> (Game, Vec<i64>) {
    let g = builtin_game("jacks-or-better").unwrap();
    let t = builtin_paytable("jacks-or-better-9-6").unwrap();
    let pays = g.pays_for_bet(&t, 5).unwrap();
    (g, pays)
}

fn ok(r: verify::Check) {
    match r {
        Ok(d) => eprintln!("{d}"),
        Err(e) => panic!("{e}"),
    }
}

#[test]
fn standard_deck_has_134459_suit_classes() {
    let (g, _) = job();
    let classes = canonical_classes(&g);
    assert_eq!(classes.len(), 134_459);
    assert_eq!(
        classes.iter().map(|c| c.weight as u64).sum::<u64>(),
        2_598_960
    );
}

#[test]
fn standard_deck_checks() {
    let (g, pays) = job();
    let an = Analyzer::new(g);
    ok(verify::fast_matches_brute_force(&an, 64, 1));
    ok(verify::probabilities_sum_to_one(&an, &pays, 5));
    ok(verify::suit_permutation_invariance(&an, 5_000, 2));
}

#[test]
fn reduced_decks_symmetry_vs_full_vs_brute_force() {
    let (g, pays) = job();
    for rg in verify::reduced_games(&g) {
        let brute = rg.deck().size() <= 21;
        let an = Analyzer::new(rg);
        ok(verify::fast_matches_brute_force(&an, 50, 3));
        ok(verify::probabilities_sum_to_one(&an, &pays, 5));
        ok(verify::suit_permutation_invariance(&an, 500, 4));
        ok(verify::symmetry_matches_full(&an, &pays, 5, brute));
    }
}

/// Every bet size gives a consistent result: below max bet, returns scale
/// exactly with bet (same table per coin), and max bet differs.
#[test]
fn bet_sizes_scale() {
    let (g, _) = job();
    let t = builtin_paytable("jacks-or-better-9-6").unwrap();
    let an = Analyzer::new(g);
    let r1 = an
        .optimal(&an.game.pays_for_bet(&t, 1).unwrap(), 1)
        .result
        .ret;
    for bet in 2..5 {
        let p = an.game.pays_for_bet(&t, bet).unwrap();
        assert_eq!(an.optimal(&p, bet).result.ret, r1, "bet {bet}");
    }
    let r5 = an
        .optimal(&an.game.pays_for_bet(&t, 5).unwrap(), 5)
        .result
        .ret;
    assert!(r5.to_f64() > r1.to_f64());
}

/// Optimal play returns at least as much as any other strategy, and the
/// optimal policy evaluated as a strategy reproduces the optimal return.
#[test]
fn policy_return_consistency() {
    let (g, pays) = job();
    let an = Analyzer::new(g);
    let opt = an.optimal(&pays, 5);
    // Policy = the stored best hold for each class representative.
    let lookup: std::collections::HashMap<[u8; 5], usize> = an
        .classes
        .iter()
        .zip(&opt.best_holds)
        .map(|(c, &m)| (c.cards, m as usize))
        .collect();
    let same = an.policy_return(&pays, 5, |h| lookup[h]);
    assert_eq!(same.ret, opt.result.ret);
    let hold_nothing = an.policy_return(&pays, 5, |_| 0);
    let hold_all = an.policy_return(&pays, 5, |_| 31);
    assert!(hold_nothing.ret.to_f64() < opt.result.ret.to_f64());
    assert!(hold_all.ret.to_f64() < opt.result.ret.to_f64());
    // Holding all five = paying the dealt hand: matches direct enumeration.
    let mut direct = 0i64;
    let all: Vec<u8> = (0..52).collect();
    ovp_engine::combin::for_each_combination(&all, 5, |h| direct += pays[an.game.category(h)]);
    assert_eq!(
        hold_all.ret,
        ovp_engine::analysis::Ratio::new(direct as i128, 2_598_960 * 5)
    );
}

/// The full 52-card deck without symmetry reduction (a few seconds).
/// Run with `cargo test -- --ignored`, or `ovp verify --full`.
#[test]
#[ignore]
fn standard_deck_symmetry_vs_full() {
    let (g, pays) = job();
    let an = Analyzer::new(g);
    ok(verify::symmetry_matches_full(&an, &pays, 5, false));
}
