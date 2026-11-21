//! Milestone 3: strategy language, evaluator, completeness checker,
//! generator, and the shipped strategy files.

use ovp_engine::analysis::{Analyzer, Ratio};
use ovp_engine::combin::for_each_combination;
use ovp_engine::game::{Game, builtin_game, builtin_paytable, builtin_paytables};
use ovp_engine::strategy::rule::{ALL_RANKS, Pattern, Rule, pat_bit};
use ovp_engine::strategy::{self, Strategy, TIERS};
use ovp_engine::verify;

/// A small hand-written strategy (ours, deliberately simple).
const SIMPLE: &str = "\
royal flush, straight flush, four of a kind, full house
4 to a royal
flush, straight
three of a kind
two pair
pair J-A
4 to a straight flush
4 to a flush
pair
4 to a straight w=2
3 to a royal
2 high cards suited
2 high cards prefer low
1 high card prefer low
discard everything
";

fn job() -> (Analyzer, Vec<i64>) {
    let g = builtin_game("jacks-or-better").unwrap();
    let t = builtin_paytable("jacks-or-better-9-6").unwrap();
    let pays = g.pays_for_bet(&t, 5).unwrap();
    (Analyzer::new(g), pays)
}

/// Return of a strategy played on every deal of the deck (no symmetry).
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

#[test]
fn simple_strategy_parses_and_is_complete() {
    let (an, pays) = job();
    let s = Strategy::parse(SIMPLE).unwrap();
    let r = strategy::evaluate(&an, &pays, 5, &s);
    assert!(
        r.is_complete(),
        "undefined {:?} ambiguous {:?}",
        r.undefined.first(),
        r.ambiguous.first()
    );
    let ret = r.ret.to_f64();
    assert!(ret > 0.98 && ret < r.optimal.to_f64(), "{ret}");
    // Per-rule numbers add up.
    let fires: f64 = r.rules.iter().map(|x| x.fires).sum();
    let loss: f64 = r.rules.iter().map(|x| x.loss).sum();
    assert!((fires - 1.0).abs() < 1e-12);
    assert!(
        (loss - r.loss_credits()).abs() < 1e-9,
        "{loss} vs {}",
        r.loss_credits()
    );
    for x in &r.rules {
        assert!(x.disagrees <= x.fires + 1e-15 && x.loss >= 0.0);
    }
    // The evaluator's return is the exact return of its chosen holds.
    assert_eq!(an.holds_return(&pays, 5, &r.holds).ret, r.ret);
}

/// Exactness of the class-based evaluation: on reduced decks, playing the
/// strategy on every single deal gives exactly the same return. This also
/// proves the rule features are suit-symmetric.
#[test]
fn strategy_return_symmetry_equals_every_deal() {
    let s = Strategy::parse(SIMPLE).unwrap();
    for gid in ["jacks-or-better", "double-double-bonus"] {
        let base = builtin_game(gid).unwrap();
        let table = builtin_paytables()
            .into_iter()
            .find(|t| t.game == gid)
            .unwrap();
        let pays = base.pays_for_bet(&table, 5).unwrap();
        for g in verify::reduced_games(&base) {
            let an = Analyzer::new(g.clone());
            let r = strategy::evaluate(&an, &pays, 5, &s);
            assert_eq!(
                r.ret,
                every_deal_return(&g, &an, &pays, 5, &s),
                "{gid} deck {}",
                g.deck().size()
            );
        }
    }
}

/// On the full deck: playing a suit-permuted hand gives the permuted hold,
/// or one with exactly equal EV.
#[test]
fn strategy_play_is_suit_symmetric() {
    let (an, pays) = job();
    let s = Strategy::parse(SIMPLE).unwrap();
    let d = an.game.deck().clone();
    let mut rng = verify::Rng::new(77);
    for _ in 0..20_000 {
        let h = rng.hand(&d);
        let perm = rng.permutation(4);
        let ph = h.map(|c| d.card(d.rank(c), perm[d.suit(c) as usize]).unwrap());
        let a = strategy::play(&an.game, &s, &h);
        let b = strategy::play(&an.game, &s, &ph);
        assert_eq!(a.rule, b.rule, "{}", d.hand_name(&h));
        let ea = an.hold_evs(&h, &pays);
        let eb = an.hold_evs(&ph, &pays);
        assert_eq!(
            ea.numer[a.hold as usize] * eb.draws[b.hold as usize],
            eb.numer[b.hold as usize] * ea.draws[a.hold as usize],
            "{}",
            d.hand_name(&h)
        );
    }
}

#[test]
fn completeness_checker_reports_undefined_hands() {
    let (an, pays) = job();
    // Without the final line, many hands match no rule.
    let mut s = Strategy::parse(SIMPLE).unwrap();
    s.rules.pop();
    let r = strategy::evaluate(&an, &pays, 5, &s);
    assert!(!r.undefined.is_empty());
    assert!(!r.is_complete());
    // Undefined hands are played as "discard everything" in the totals.
    assert!(r.undefined.iter().all(|p| p.rule.is_none()));
}

/// SPEC §3.1: exactly tied holds are equivalent. Swapping every best hold
/// for a different member of its tie set leaves the exact return unchanged,
/// and such ties really occur.
#[test]
fn tied_holds_are_equivalent() {
    let (an, pays) = job();
    let mut best = vec![];
    let mut alt = vec![];
    let mut tied_classes = 0;
    for cl in &an.classes {
        let evs = an.hold_evs(&cl.cards, &pays);
        let set = strategy::evaluate::optimal_set(&evs);
        let b = evs.best() as u8;
        let other = (0..32u8).rev().find(|&m| set >> m & 1 == 1).unwrap();
        if other != b {
            tied_classes += 1;
        }
        best.push(b);
        alt.push(other);
    }
    assert!(tied_classes > 0);
    assert_eq!(
        an.holds_return(&pays, 5, &best).ret,
        an.holds_return(&pays, 5, &alt).ret
    );
}

#[test]
fn matching_rules_lists_every_applicable_rule_in_order() {
    let (an, _) = job();
    let s = Strategy::parse(SIMPLE).unwrap();
    let d = an.game.deck();
    let h = d.parse_hand("Ah Kh Qh Jh 2c").unwrap();
    let m = strategy::matching_rules(&an.game, &s, &h);
    let names: Vec<String> = m.iter().map(|(i, _)| s.rules[*i].to_string()).collect();
    assert_eq!(names[0], "4 to a royal");
    assert!(names.contains(&"3 to a royal".to_string()));
    assert_eq!(names.last().unwrap(), "discard everything");
    assert!(m.windows(2).all(|w| w[0].0 < w[1].0));
}

/// Generator on a reduced deck (fast): complete, within caps, its own loss
/// equals the exact evaluation, tiers improve monotonically, beginner has no
/// qualifiers and intermediate only flush penalties.
#[test]
fn generator_contract() {
    let base = builtin_game("double-double-bonus").unwrap();
    let table = builtin_paytable("double-double-bonus-9-6").unwrap();
    let pays = base.pays_for_bet(&table, 5).unwrap();
    for g in verify::reduced_games(&base).into_iter().take(2) {
        let an = Analyzer::new(g);
        let gens = strategy::generate_tiers(&an, &pays, &TIERS);
        let mut prev = f64::INFINITY;
        for (t, g) in TIERS.iter().zip(&gens) {
            let r = strategy::evaluate(&an, &pays, 5, &g.strategy);
            assert!(r.is_complete(), "{}", t.name);
            assert!(g.strategy.rules.len() <= t.max_lines);
            assert!(
                (g.loss - r.loss_credits()).abs() < 1e-9,
                "{}: {} vs {}",
                t.name,
                g.loss,
                r.loss_credits()
            );
            assert!(
                r.loss_credits() <= prev + 1e-12,
                "{} worse than lower tier",
                t.name
            );
            prev = r.loss_credits();
            check_tier_qualifiers(t.name, &g.strategy.rules);
            // Round trip through text.
            assert_eq!(Strategy::parse(&g.strategy.to_text()).unwrap(), g.strategy);
        }
    }
}

fn check_tier_qualifiers(tier: &str, rules: &[Rule]) {
    for r in rules {
        match tier {
            "beginner" => assert!(!r.has_qualifier(), "beginner rule with qualifier: {r}"),
            "intermediate" => assert!(r.sp.is_none(), "intermediate rule with sp: {r}"),
            _ => {}
        }
    }
}

fn header(text: &str, key: &str) -> String {
    text.lines()
        .find_map(|l| l.strip_prefix(&format!("# {key}: ")))
        .unwrap_or_else(|| panic!("missing header {key}"))
        .to_string()
}

/// Every shipped strategy: one per preset × tier, parses, is complete,
/// covers every pat hand, respects its tier, and its recorded numbers match
/// a fresh exact evaluation.
fn check_shipped(gid: &str) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../strategies");
    let an = Analyzer::new(builtin_game(gid).unwrap());
    for table in builtin_paytables().into_iter().filter(|t| t.game == gid) {
        let pays = an.game.pays_for_bet(&table, 5).unwrap();
        let mut prev = f64::INFINITY;
        for tier in &TIERS {
            let path = dir.join(&table.id).join(format!("{}.txt", tier.name));
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            assert_eq!(header(&text, "paytable"), table.id);
            assert_eq!(header(&text, "game"), gid);
            let s = Strategy::parse(&text).unwrap();
            assert!(s.rules.len() <= tier.max_lines, "{}", path.display());
            check_tier_qualifiers(tier.name, &s.rules);
            let r = strategy::evaluate(&an, &pays, 5, &s);
            assert!(r.is_complete(), "{} incomplete", path.display());
            let ret = format!("{:.6}%", r.ret.to_f64() * 100.0);
            assert!(
                header(&text, "return").starts_with(&ret),
                "{}: header {} vs {ret}",
                path.display(),
                header(&text, "return")
            );
            // Every pat hand has a line that keeps it.
            let mut covered = 0u8;
            for r in &s.rules {
                covered |= match r.pattern {
                    Pattern::Pat(m) => m,
                    Pattern::Made(k) => 1 << pat_bit(k).unwrap(),
                    Pattern::Quads {
                        ranks: ALL_RANKS,
                        kicker: None,
                    } => 1 << 2,
                    _ => 0,
                };
            }
            assert_eq!(
                covered,
                0b11_1111,
                "{}: pat hands not all covered",
                path.display()
            );
            assert!(
                r.loss_credits() <= prev + 1e-12,
                "{} worse than the tier below",
                path.display()
            );
            prev = r.loss_credits();
        }
    }
}

#[test]
fn shipped_jacks_or_better() {
    check_shipped("jacks-or-better");
}
#[test]
fn shipped_bonus_poker() {
    check_shipped("bonus-poker");
}
#[test]
fn shipped_double_bonus() {
    check_shipped("double-bonus");
}
#[test]
fn shipped_double_double_bonus() {
    check_shipped("double-double-bonus");
}

/// Tidy drops pat hands that earlier lines already keep, without changing play.
#[test]
fn tidy_removes_unreachable_pat_hands() {
    let (an, pays) = job();
    let s = Strategy::parse(
        "straight flush\nroyal flush\n4 to a royal\nroyal flush, straight flush, four of a kind, full house\nflush, straight\npair\ndiscard everything\n",
    )
    .unwrap();
    let t = strategy::tidy(&s);
    assert_eq!(t.rules[3].to_string(), "four of a kind, full house");
    assert_eq!(t.rules.len(), s.rules.len());
    let a = strategy::evaluate(&an, &pays, 5, &s);
    let b = strategy::evaluate(&an, &pays, 5, &t);
    assert_eq!(a.holds, b.holds);
    assert_eq!(a.ret, b.ret);
    // A pat line that is entirely covered disappears.
    let s2 = Strategy::parse("flush\nstraight\nflush, straight\ndiscard everything\n").unwrap();
    assert_eq!(strategy::tidy(&s2).rules.len(), 3);
}
