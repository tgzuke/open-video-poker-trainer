//! `ovp` — command-line front end to the engine.
//!
//!   ovp analyze  [--paytable ID] [--bet N]
//!   ovp holds    [--paytable ID] [--bet N] "As Ks Qs Js 2c"
//!   ovp verify   [--paytable ID] [--samples N] [--seed N] [--full]
//!   ovp list

use ovp_engine::analysis::Analyzer;
use ovp_engine::cards::Card;
use ovp_engine::game::{BUILTIN_PAYTABLES, Game, PayTable, builtin_game, builtin_paytable};
use ovp_engine::verify;
use std::process::ExitCode;
use std::time::Instant;

const DEFAULT_PAYTABLE: &str = "jacks-or-better-9-6";
/// Informational cross-check only (SPEC §3.3): widely published figure.
const PUBLISHED: &[(&str, f64)] = &[("jacks-or-better-9-6", 99.5439)];

struct Opts {
    paytable: String,
    bet: Option<u32>,
    samples: usize,
    seed: u64,
    full: bool,
    positional: Vec<String>,
}

fn parse_opts(args: &[String]) -> Result<Opts, String> {
    let mut o = Opts {
        paytable: DEFAULT_PAYTABLE.into(),
        bet: None,
        samples: 200,
        seed: 0x5EED,
        full: false,
        positional: vec![],
    };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut val = |name: &str| it.next().cloned().ok_or(format!("{name} needs a value"));
        match a.as_str() {
            "--paytable" | "-p" => o.paytable = val(a)?,
            "--bet" | "-b" => o.bet = Some(val(a)?.parse().map_err(|_| "bad --bet")?),
            "--samples" => o.samples = val(a)?.parse().map_err(|_| "bad --samples")?,
            "--seed" => o.seed = val(a)?.parse().map_err(|_| "bad --seed")?,
            "--full" => o.full = true,
            s if s.starts_with('-') => return Err(format!("unknown option {s}")),
            s => o.positional.push(s.to_string()),
        }
    }
    Ok(o)
}

fn load(o: &Opts) -> Result<(Game, PayTable, u32), String> {
    let table = builtin_paytable(&o.paytable)?;
    let game = builtin_game(&table.game)?;
    let bet = o.bet.unwrap_or(game.def.max_bet);
    game.pays_for_bet(&table, bet)?;
    Ok((game, table, bet))
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn cmd_analyze(o: &Opts) -> Result<(), String> {
    let (game, table, bet) = load(o)?;
    let pays = game.pays_for_bet(&table, bet)?;
    println!("Game:      {} ({})", game.def.name, game.def.label);
    println!("Pay table: {} [{}]", table.name, table.id);
    println!("Bet:       {bet} credit(s)");

    let t = Instant::now();
    let an = Analyzer::new(game);
    let t_build = ms(t);
    let t = Instant::now();
    let opt = an.optimal(&pays, bet);
    let t_analyze = ms(t);

    let r = &opt.result;
    println!();
    println!("Optimal return: {:.6}%", r.ret.to_f64() * 100.0);
    println!("  exact:        {} / {}", r.ret.num, r.ret.den);
    println!("  EV per hand:  {:.6} credits", r.ret.to_f64() * bet as f64);
    if let Some((_, p)) = PUBLISHED.iter().find(|(id, _)| *id == table.id) {
        if bet == an.game.def.max_bet {
            println!("  (informational: commonly published figure {p:.4}%)");
        }
    }
    println!();
    println!(
        "{:<18} {:>12} {:>14}",
        "Outcome", "Probability", "Return share"
    );
    for (c, p) in r.category_probs.iter().enumerate() {
        let share = p.to_f64() * pays[c] as f64 / bet as f64 * 100.0;
        println!(
            "{:<18} {:>12.8} {:>13.6}%",
            an.game.category_name(c),
            p.to_f64(),
            share
        );
    }

    // Per-hand timing on random deals.
    let mut rng = verify::Rng::new(o.seed);
    let hands: Vec<[Card; 5]> = (0..20_000).map(|_| rng.hand(an.game.deck())).collect();
    let t = Instant::now();
    let mut sink = 0usize;
    for h in &hands {
        sink += an.hold_evs(h, &pays).best();
    }
    let per_hand_us = ms(t) * 1000.0 / hands.len() as f64;
    std::hint::black_box(sink);

    println!();
    println!("Timing (native, single thread):");
    println!(
        "  draw tables:        {t_build:9.1} ms ({:.1} MB)",
        an.tables.memory_bytes() as f64 / 1e6
    );
    println!(
        "  full-game analysis: {t_analyze:9.1} ms ({} suit classes)",
        an.classes.len()
    );
    println!("  32-hold EV:         {per_hand_us:9.2} µs per hand");
    Ok(())
}

fn cmd_holds(o: &Opts) -> Result<(), String> {
    let (game, table, bet) = load(o)?;
    let pays = game.pays_for_bet(&table, bet)?;
    let hand_str = o.positional.join(" ");
    let hand = game.deck().parse_hand(&hand_str)?;
    let an = Analyzer::new(game);
    let deck = an.game.deck();
    let evs = an.hold_evs(&hand, &pays);
    let mut order: Vec<usize> = (0..32).collect();
    order.sort_by(|&a, &b| evs.cmp(b, a).then(a.cmp(&b)));
    println!(
        "{} — {} {}, bet {bet}",
        deck.hand_name(&hand),
        an.game.def.name,
        table.name
    );
    for m in order {
        let held: Vec<String> = (0..5)
            .map(|i| {
                if (m >> i) & 1 == 1 {
                    deck.card_name(hand[i])
                } else {
                    "--".into()
                }
            })
            .collect();
        println!("  {}   {:>12.6}", held.join(" "), evs.ev(m));
    }
    Ok(())
}

fn report(name: &str, r: verify::Check, t: Instant) -> bool {
    match r {
        Ok(d) => {
            println!("PASS  {name} ({:.0} ms)\n      {d}", ms(t));
            true
        }
        Err(e) => {
            println!("FAIL  {name}\n      {e}");
            false
        }
    }
}

fn cmd_verify(o: &Opts) -> Result<bool, String> {
    let (game, table, bet) = load(o)?;
    let pays = game.pays_for_bet(&table, bet)?;
    println!(
        "Verification suite (SPEC §3.3) — {} {}, bet {bet}\n",
        game.def.name, table.name
    );
    let reduced = verify::reduced_games(&game);
    let an = Analyzer::new(game);
    let mut ok = true;

    let t = Instant::now();
    ok &= report(
        "fast EV path == brute force",
        verify::fast_matches_brute_force(&an, o.samples, o.seed),
        t,
    );
    let t = Instant::now();
    ok &= report(
        "probabilities sum to 1",
        verify::probabilities_sum_to_one(&an, &pays, bet),
        t,
    );
    let t = Instant::now();
    ok &= report(
        "suit-permutation invariance",
        verify::suit_permutation_invariance(&an, o.samples * 50, o.seed + 1),
        t,
    );
    for g in reduced {
        let name = format!(
            "symmetry == no symmetry, reduced deck ({} ranks × {} suits)",
            g.deck().ranks().len(),
            g.deck().suits()
        );
        let brute = g.deck().size() <= 21;
        let ran = Analyzer::new(g);
        let t = Instant::now();
        ok &= report(
            &name,
            verify::probabilities_sum_to_one(&ran, &pays, bet)
                .and_then(|_| verify::fast_matches_brute_force(&ran, 50, o.seed + 2))
                .and_then(|_| verify::symmetry_matches_full(&ran, &pays, bet, brute)),
            t,
        );
    }
    if o.full {
        let t = Instant::now();
        ok &= report(
            "symmetry == no symmetry, full 52-card deck",
            verify::symmetry_matches_full(&an, &pays, bet, false),
            t,
        );
    }
    println!(
        "\n{}",
        if ok {
            "ALL CHECKS PASSED"
        } else {
            "SOME CHECKS FAILED"
        }
    );
    Ok(ok)
}

fn usage() -> &'static str {
    "usage:\n  ovp analyze [--paytable ID] [--bet N]\n  ovp holds   [--paytable ID] [--bet N] \"As Ks Qs Js 2c\"\n  ovp verify  [--paytable ID] [--samples N] [--seed N] [--full]\n  ovp list"
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first() else {
        eprintln!("{}", usage());
        return ExitCode::from(2);
    };
    let o = match parse_opts(&args[1..]) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("error: {e}\n{}", usage());
            return ExitCode::from(2);
        }
    };
    let res = match cmd.as_str() {
        "analyze" => cmd_analyze(&o).map(|_| true),
        "holds" => cmd_holds(&o).map(|_| true),
        "verify" => cmd_verify(&o),
        "list" => {
            for (id, _) in BUILTIN_PAYTABLES {
                println!("{id}");
            }
            Ok(true)
        }
        _ => Err(format!("unknown command '{cmd}'\n{}", usage())),
    };
    match res {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
