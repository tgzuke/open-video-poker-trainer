//! Milestone 2: every game and preset, bet sizes, progressive royal, custom
//! tables. The §3.3 checks run for every game, not just Jacks or Better.

use ovp_engine::analysis::Analyzer;
use ovp_engine::game::{Wager, builtin_game, builtin_paytable, builtin_paytables, with_overrides};
use ovp_engine::verify;

fn ok(r: verify::Check) {
    match r {
        Ok(d) => eprintln!("{d}"),
        Err(e) => panic!("{e}"),
    }
}

/// Fast path, probabilities, suit invariance, and symmetry-vs-full (with
/// table-free brute force on the 20-card decks) for one game.
fn verify_game(id: &str) {
    let g = builtin_game(id).unwrap();
    let table = builtin_paytables()
        .into_iter()
        .find(|t| t.game == id)
        .unwrap();
    let pays = g.pays_for_bet(&table, 5).unwrap();
    let reduced = verify::reduced_games(&g);
    let an = Analyzer::new(g);
    ok(verify::fast_matches_brute_force(&an, 32, 11));
    ok(verify::probabilities_sum_to_one(&an, &pays, 5));
    ok(verify::suit_permutation_invariance(&an, 2_000, 12));
    for rg in reduced {
        let brute = rg.deck().size() <= verify::BRUTE_MAX_DECK;
        let ran = Analyzer::new(rg);
        ok(verify::fast_matches_brute_force(&ran, 30, 13));
        ok(verify::probabilities_sum_to_one(&ran, &pays, 5));
        ok(verify::symmetry_matches_full(&ran, &pays, 5, brute));
    }
}

#[test]
fn verify_bonus_poker() {
    verify_game("bonus-poker");
}
#[test]
fn verify_double_bonus() {
    verify_game("double-bonus");
}
#[test]
fn verify_double_double_bonus() {
    verify_game("double-double-bonus");
}

/// Every preset of a game analyzes; bet size and progressive behave correctly.
fn presets_bet_and_progressive(gid: &str) {
    let an = Analyzer::new(builtin_game(gid).unwrap());
    let tables: Vec<_> = builtin_paytables()
        .into_iter()
        .filter(|t| t.game == gid)
        .collect();
    assert!(!tables.is_empty());
    for t in &tables {
        let r = an
            .optimal(&an.game.pays_for_bet(t, 5).unwrap(), 5)
            .result
            .ret
            .to_f64();
        assert!((0.9..1.02).contains(&r), "{}: implausible return {r}", t.id);
        ok(verify::wager_checks(&an, t));
    }
}

#[test]
fn presets_jacks_or_better() {
    presets_bet_and_progressive("jacks-or-better");
}
#[test]
fn presets_bonus_poker() {
    presets_bet_and_progressive("bonus-poker");
}
#[test]
fn presets_double_bonus() {
    presets_bet_and_progressive("double-bonus");
}
#[test]
fn presets_double_double_bonus() {
    presets_bet_and_progressive("double-double-bonus");
}

/// Every preset file belongs to one of the four games tested above.
#[test]
fn presets_all_covered() {
    let known = [
        "jacks-or-better",
        "bonus-poker",
        "double-bonus",
        "double-double-bonus",
    ];
    for t in builtin_paytables() {
        assert!(known.contains(&t.game.as_str()), "{} not covered", t.id);
    }
}

/// Better pays can only raise the return; a custom table equal to a preset
/// gives exactly the preset's result.
#[test]
fn custom_tables() {
    let an = Analyzer::new(builtin_game("jacks-or-better").unwrap());
    let ret = |t: &ovp_engine::game::PayTable| {
        an.optimal(&an.game.pays_for_bet(t, 5).unwrap(), 5)
            .result
            .ret
    };
    let t96 = builtin_paytable("jacks-or-better-9-6").unwrap();
    let custom86 = with_overrides(&t96, &[("full_house".into(), 8)]);
    assert_eq!(
        ret(&custom86),
        ret(&builtin_paytable("jacks-or-better-8-6").unwrap())
    );
    let better = with_overrides(&t96, &[("two_pair".into(), 3)]);
    assert!(ret(&better).to_f64() > ret(&t96).to_f64());
    let worse = with_overrides(&t96, &[("jacks_or_better".into(), 0)]);
    assert!(ret(&worse).to_f64() < ret(&t96).to_f64());
}

/// A large progressive changes the optimal hold on a hand where the royal
/// draw competes with a made pay, at max bet only.
#[test]
fn progressive_changes_strategy() {
    let an = Analyzer::new(builtin_game("jacks-or-better").unwrap());
    let t = builtin_paytable("jacks-or-better-9-6").unwrap();
    let d = an.game.deck();
    // High pair vs 3 to a royal: keep the pair normally, chase a huge royal.
    let h = d.parse_hand("Js Jh Qs Ks 2d").unwrap();
    let pair = 0b00011;
    let three_royal = 0b01101;
    let base = an
        .hold_evs(&h, &an.game.pays(&t, Wager::bet(5)).unwrap())
        .best();
    assert_eq!(base, pair);
    let big = an.hold_evs(
        &h,
        &an.game
            .pays(
                &t,
                Wager {
                    bet: 5,
                    progressive: Some(40_000),
                },
            )
            .unwrap(),
    );
    assert_eq!(big.best(), three_royal);
    let low = an.hold_evs(
        &h,
        &an.game
            .pays(
                &t,
                Wager {
                    bet: 4,
                    progressive: Some(40_000),
                },
            )
            .unwrap(),
    );
    assert_eq!(low.best(), pair);
}
