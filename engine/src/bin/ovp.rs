//! `ovp` — command-line front end to the engine.

use ovp_engine::analysis::Analyzer;
use ovp_engine::cards::Card;
use ovp_engine::game::{
    Game, PayTable, Wager, builtin_game, builtin_games, builtin_paytable, builtin_paytables,
    parse_paytable, with_overrides,
};
use ovp_engine::strategy::{self, FileMeta, Strategy};
use ovp_engine::verify;
use std::process::ExitCode;
use std::time::Instant;

const DEFAULT_PAYTABLE: &str = "jacks-or-better-9-6";

const USAGE: &str = "\
usage:
  ovp list
  ovp analyze [TABLE] [--bet N] [--progressive CREDITS]
  ovp analyze --all [--bet N] [--progressive CREDITS]
  ovp holds   [TABLE] [--bet N] [--progressive CREDITS] \"As Ks Qs Js 2c\"
  ovp verify  [TABLE | --all] [--samples N] [--seed N] [--full]
  ovp strategy generate [TABLE] [--bet N] [--progressive C] --tier T [--max-lines N] [--out FILE]
  ovp strategy generate --all [--out DIR]       every preset × every tier
  ovp strategy eval FILE [TABLE] [--bet N] [--progressive C]
  ovp strategy compare FILE_A FILE_B [TABLE_B] [--bet N] [--progressive C]
                                                how B differs from A, each change's
                                                EV effect playing table B
  ovp strategy tidy FILE...                     tidy + reading order (play unchanged)
  ovp strategy play FILE [TABLE] \"As Ks Qs Js 2c\"

TABLE selects a pay table (default jacks-or-better-9-6):
  --paytable ID | -p ID      a preset (see `ovp list`)
  --paytable-file FILE       a custom table (JSON with id, game, name, pays)
  --set LINE=N               override a per-coin pay (repeatable);
                             --set max:LINE=N sets a max-bet total
--progressive replaces the royal's max-bet payout with CREDITS (max bet only).";

struct Opts {
    paytable: String,
    paytable_file: Option<String>,
    overrides: Vec<(String, i64)>,
    bet: Option<u32>,
    progressive: Option<i64>,
    all: bool,
    samples: usize,
    seed: u64,
    full: bool,
    tier: Option<String>,
    max_lines: Option<usize>,
    out: Option<String>,
    positional: Vec<String>,
}

fn parse_opts(args: &[String]) -> Result<Opts, String> {
    let mut o = Opts {
        paytable: DEFAULT_PAYTABLE.into(),
        paytable_file: None,
        overrides: vec![],
        bet: None,
        progressive: None,
        all: false,
        samples: 200,
        seed: 0x5EED,
        full: false,
        tier: None,
        max_lines: None,
        out: None,
        positional: vec![],
    };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut val = |name: &str| it.next().cloned().ok_or(format!("{name} needs a value"));
        match a.as_str() {
            "--paytable" | "-p" => o.paytable = val(a)?,
            "--paytable-file" => o.paytable_file = Some(val(a)?),
            "--set" => {
                let v = val(a)?;
                let (k, n) = v.split_once('=').ok_or("--set expects LINE=N")?;
                let n = n
                    .trim()
                    .parse()
                    .map_err(|_| format!("bad number in --set {v}"))?;
                o.overrides.push((k.trim().to_string(), n));
            }
            "--bet" | "-b" => o.bet = Some(val(a)?.parse().map_err(|_| "bad --bet")?),
            "--progressive" => {
                o.progressive = Some(
                    val(a)?
                        .parse()
                        .map_err(|_| "--progressive takes whole credits")?,
                )
            }
            "--all" => o.all = true,
            "--samples" => o.samples = val(a)?.parse().map_err(|_| "bad --samples")?,
            "--seed" => o.seed = val(a)?.parse().map_err(|_| "bad --seed")?,
            "--full" => o.full = true,
            "--tier" => o.tier = Some(val(a)?),
            "--max-lines" => o.max_lines = Some(val(a)?.parse().map_err(|_| "bad --max-lines")?),
            "--out" | "-o" => o.out = Some(val(a)?),
            s if s.starts_with('-') => return Err(format!("unknown option {s}")),
            s => o.positional.push(s.to_string()),
        }
    }
    Ok(o)
}

/// The selected pay table (preset or file, plus overrides) and its game.
fn load_table(o: &Opts) -> Result<(Game, PayTable), String> {
    let base = match &o.paytable_file {
        Some(f) => {
            let json = std::fs::read_to_string(f).map_err(|e| format!("{f}: {e}"))?;
            parse_paytable(&json)?
        }
        None => builtin_paytable(&o.paytable)?,
    };
    let table = with_overrides(&base, &o.overrides);
    let game = builtin_game(&table.game)?;
    game.validate_paytable(&table)?;
    Ok((game, table))
}

fn wager(o: &Opts, game: &Game) -> Result<Wager, String> {
    let w = Wager {
        bet: o.bet.unwrap_or(game.def.max_bet),
        progressive: o.progressive,
    };
    if w.progressive.is_some() && w.bet != game.def.max_bet {
        eprintln!(
            "note: the progressive only pays at max bet ({}); ignored at bet {}",
            game.def.max_bet, w.bet
        );
    }
    Ok(w)
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn describe_wager(w: Wager) -> String {
    match w.progressive {
        Some(p) => format!("{} credit(s), progressive royal {p}", w.bet),
        None => format!("{} credit(s)", w.bet),
    }
}

fn cmd_analyze(o: &Opts) -> Result<(), String> {
    if o.all {
        return cmd_analyze_all(o);
    }
    let (game, table) = load_table(o)?;
    let w = wager(o, &game)?;
    let pays = game.pays(&table, w)?;
    println!("Game:      {} ({})", game.def.name, game.def.label);
    println!("Pay table: {} [{}]", table.name, table.id);
    println!("Bet:       {}", describe_wager(w));

    let t = Instant::now();
    let an = Analyzer::new(game);
    let t_build = ms(t);
    let t = Instant::now();
    let opt = an.optimal(&pays, w.bet);
    let t_analyze = ms(t);

    let r = &opt.result;
    println!();
    println!("Optimal return: {:.6}%", r.ret.to_f64() * 100.0);
    println!("  exact:        {} / {}", r.ret.num, r.ret.den);
    println!(
        "  EV per hand:  {:.6} credits",
        r.ret.to_f64() * w.bet as f64
    );
    if let Some(p) = table.published_return_pct {
        if w.bet == an.game.def.max_bet && w.progressive.is_none() {
            println!("  (informational: commonly published figure {p}%)");
        }
    }
    println!();
    println!(
        "{:<20} {:>7} {:>12} {:>14}",
        "Outcome", "Pays", "Probability", "Return share"
    );
    for (c, p) in r.category_probs.iter().enumerate() {
        let share = p.to_f64() * pays[c] as f64 / w.bet as f64 * 100.0;
        println!(
            "{:<20} {:>7} {:>12.8} {:>13.6}%",
            an.game.category_name(c),
            pays[c],
            p.to_f64(),
            share
        );
    }

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

fn cmd_analyze_all(o: &Opts) -> Result<(), String> {
    let tables = builtin_paytables();
    println!(
        "{:<30} {:<22} {:>12} {:>12} {:>9}",
        "Pay table", "Game (label)", "Return %", "Published %", "Time ms"
    );
    let t_all = Instant::now();
    for game in builtin_games() {
        let t = Instant::now();
        let an = Analyzer::new(game);
        let t_build = ms(t);
        for table in tables.iter().filter(|t| t.game == an.game.def.id) {
            let w = wager(o, &an.game)?;
            let pays = an.game.pays(table, w)?;
            let t = Instant::now();
            let r = an.optimal(&pays, w.bet).result.ret;
            let published = match table.published_return_pct {
                Some(p) if w.bet == an.game.def.max_bet && w.progressive.is_none() => {
                    format!("{p}")
                }
                _ => "-".into(),
            };
            println!(
                "{:<30} {:<22} {:>12.6} {:>12} {:>9.0}",
                table.id,
                an.game.def.label,
                r.to_f64() * 100.0,
                published,
                ms(t)
            );
        }
        println!("{:<30} (draw tables {t_build:.0} ms)", "");
    }
    println!(
        "\n{} presets, bet {}, total {:.1} s",
        tables.len(),
        o.bet.map_or("max".to_string(), |b| b.to_string()),
        ms(t_all) / 1000.0
    );
    if o.progressive.is_some() {
        println!(
            "progressive royal {} credits at max bet",
            o.progressive.unwrap()
        );
    }
    Ok(())
}

fn cmd_holds(o: &Opts) -> Result<(), String> {
    let (game, table) = load_table(o)?;
    let w = wager(o, &game)?;
    let pays = game.pays(&table, w)?;
    let hand = game.deck().parse_hand(&o.positional.join(" "))?;
    let an = Analyzer::new(game);
    let deck = an.game.deck();
    let evs = an.hold_evs(&hand, &pays);
    let mut order: Vec<usize> = (0..32).collect();
    order.sort_by(|&a, &b| evs.cmp(b, a).then(a.cmp(&b)));
    println!(
        "{} — {} {}, bet {}",
        deck.hand_name(&hand),
        an.game.def.name,
        table.name,
        describe_wager(w)
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

fn verify_game(
    o: &Opts,
    game: Game,
    table: &PayTable,
    all_tables: &[PayTable],
) -> Result<bool, String> {
    let bet = game.def.max_bet;
    let pays = game.pays_for_bet(table, bet)?;
    println!("== {} — {} (bet {bet})\n", game.def.name, table.name);
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
        let brute = g.deck().size() <= verify::BRUTE_MAX_DECK;
        let ran = Analyzer::new(g);
        let t = Instant::now();
        let r = verify::probabilities_sum_to_one(&ran, &pays, bet)
            .and_then(|_| verify::fast_matches_brute_force(&ran, 50, o.seed + 2))
            .and_then(|_| verify::symmetry_matches_full(&ran, &pays, bet, brute));
        ok &= report(&name, r, t);
    }
    if o.full {
        let t = Instant::now();
        ok &= report(
            "symmetry == no symmetry, full deck",
            verify::symmetry_matches_full(&an, &pays, bet, false),
            t,
        );
    }
    for t in all_tables {
        let start = Instant::now();
        ok &= report(
            &format!("bet size & progressive: {}", t.id),
            verify::wager_checks(&an, t),
            start,
        );
    }
    println!();
    Ok(ok)
}

fn cmd_verify(o: &Opts) -> Result<bool, String> {
    println!("Verification suite (SPEC §3.3)\n");
    let mut ok = true;
    if o.all {
        let tables = builtin_paytables();
        for game in builtin_games() {
            let mine: Vec<PayTable> = tables
                .iter()
                .filter(|t| t.game == game.def.id)
                .cloned()
                .collect();
            let first = mine.first().ok_or("game with no tables")?.clone();
            ok &= verify_game(o, game, &first, &mine)?;
        }
    } else {
        let (game, table) = load_table(o)?;
        ok &= verify_game(o, game, &table, std::slice::from_ref(&table))?;
    }
    println!(
        "{}",
        if ok {
            "ALL CHECKS PASSED"
        } else {
            "SOME CHECKS FAILED"
        }
    );
    Ok(ok)
}

/// Generates the requested tiers (each warm-started from the one below) and
/// returns (tier, file text, report, seconds) for each.
fn generate_for(
    an: &Analyzer,
    table: &PayTable,
    w: Wager,
    tiers: &[strategy::Tier],
) -> Result<Vec<(strategy::Tier, String, strategy::Report, f64)>, String> {
    let pays = an.game.pays(table, w)?;
    let mut out = Vec::new();
    let mut seed: Option<Strategy> = None;
    for tier in tiers {
        let t = Instant::now();
        let g = strategy::generate(an, &pays, tier, seed.as_ref());
        let secs = t.elapsed().as_secs_f64();
        let (text, report) = check_and_render(an, table, w, tier, &pays, &g)?;
        seed = Some(g.strategy);
        out.push((*tier, text, report, secs));
    }
    Ok(out)
}

fn check_and_render(
    an: &Analyzer,
    table: &PayTable,
    w: Wager,
    tier: &strategy::Tier,
    pays: &[i64],
    g: &strategy::generate::Generated,
) -> Result<(String, strategy::Report), String> {
    let pays = pays.to_vec();
    let report = strategy::evaluate(an, &pays, w.bet, &g.strategy);
    if !report.is_complete() {
        return Err(format!(
            "{} {}: generated strategy is incomplete",
            table.id, tier.name
        ));
    }
    if (report.loss_credits() - g.loss).abs() > 1e-9 {
        return Err(format!(
            "{} {}: search loss {} disagrees with exact evaluation {}",
            table.id,
            tier.name,
            g.loss,
            report.loss_credits()
        ));
    }
    let meta = FileMeta {
        game: &an.game.def.id,
        paytable: &table.id,
        bet: w.bet,
        progressive: w.progressive,
        tier: Some(tier),
    };
    Ok((strategy::render_file(&g.strategy, &report, &meta), report))
}

fn cmd_strategy(o: &Opts) -> Result<bool, String> {
    let sub = o.positional.first().map(String::as_str).unwrap_or("");
    match sub {
        "generate" if o.all => {
            let dir = o.out.clone().unwrap_or_else(|| "../strategies".into());
            let tables = builtin_paytables();
            println!(
                "{:<30} {:<13} {:>6} {:>11} {:>12} {:>8}",
                "Pay table", "Tier", "Lines", "Return %", "Loss cr/hd", "Time s"
            );
            for game in builtin_games() {
                let an = Analyzer::new(game);
                for table in tables.iter().filter(|t| t.game == an.game.def.id) {
                    let w = Wager::bet(an.game.def.max_bet);
                    let tdir = format!("{dir}/{}", table.id);
                    std::fs::create_dir_all(&tdir).map_err(|e| format!("{tdir}: {e}"))?;
                    for (tier, text, rep, secs) in generate_for(&an, table, w, &strategy::TIERS)? {
                        let path = format!("{tdir}/{}.txt", tier.name);
                        std::fs::write(&path, &text).map_err(|e| format!("{path}: {e}"))?;
                        println!(
                            "{:<30} {:<13} {:>6} {:>11.6} {:>12.6} {:>8.1}",
                            table.id,
                            tier.name,
                            rep.rules.len(),
                            rep.ret.to_f64() * 100.0,
                            rep.loss_credits(),
                            secs
                        );
                    }
                }
            }
            Ok(true)
        }
        "generate" => {
            let (game, table) = load_table(o)?;
            let w = wager(o, &game)?;
            let mut tier = strategy::tier(o.tier.as_deref().ok_or("--tier is required")?)?;
            if let Some(n) = o.max_lines {
                tier = tier.with_max_lines(n)?;
            }
            let an = Analyzer::new(game);
            // Lower tiers seed the requested one.
            let upto: Vec<strategy::Tier> = strategy::TIERS
                .iter()
                .take_while(|t| t.name != tier.name)
                .copied()
                .chain([tier])
                .collect();
            let (_, text, _, secs) = generate_for(&an, &table, w, &upto)?.pop().unwrap();
            match &o.out {
                Some(f) => {
                    std::fs::write(f, &text).map_err(|e| format!("{f}: {e}"))?;
                    eprintln!("wrote {f} ({secs:.1} s)");
                }
                None => {
                    print!("{text}");
                    eprintln!("({secs:.1} s)");
                }
            }
            Ok(true)
        }
        "eval" => {
            let file = o.positional.get(1).ok_or("strategy eval needs a FILE")?;
            let text = std::fs::read_to_string(file).map_err(|e| format!("{file}: {e}"))?;
            let strat = Strategy::parse(&text)?;
            let (game, table) = load_table(o)?;
            let w = wager(o, &game)?;
            let pays = game.pays(&table, w)?;
            let an = Analyzer::new(game);
            let rep = strategy::evaluate(&an, &pays, w.bet, &strat);
            let meta = FileMeta {
                game: &an.game.def.id,
                paytable: &table.id,
                bet: w.bet,
                progressive: w.progressive,
                tier: None,
            };
            print!("{}", strategy::render_file(&strat, &rep, &meta));
            if !rep.worst.is_empty() {
                println!("# costliest misplays (hand classes; credits/hand lost):");
                let fmt = |hand: &str, m: u8| -> String {
                    hand.split(' ')
                        .enumerate()
                        .map(|(i, c)| {
                            if m >> i & 1 == 1 {
                                c.to_string()
                            } else {
                                "--".into()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                };
                for (l, hand, r, h, b) in rep.worst.iter().take(15) {
                    println!(
                        "#   {l:.7}  {hand}  rule {:>2} holds {}  optimal {}",
                        r + 1,
                        fmt(hand, *h),
                        fmt(hand, *b)
                    );
                }
            }
            for (label, list) in [("UNDEFINED", &rep.undefined), ("AMBIGUOUS", &rep.ambiguous)] {
                if !list.is_empty() {
                    println!("# {label}: {} hand classes, e.g.", list.len());
                    for p in list.iter().take(10) {
                        println!("#   {} (rule {:?})", p.hand, p.rule.map(|i| i + 1));
                    }
                }
            }
            Ok(rep.is_complete())
        }
        "compare" => {
            let read = |i: usize| -> Result<Strategy, String> {
                let file = o
                    .positional
                    .get(i)
                    .ok_or("strategy compare needs FILE_A and FILE_B")?;
                let text = std::fs::read_to_string(file).map_err(|e| format!("{file}: {e}"))?;
                Strategy::parse(&text).map_err(|e| format!("{file}: {e}"))
            };
            let (a, b) = (read(1)?, read(2)?);
            let (game, table) = load_table(o)?;
            let w = wager(o, &game)?;
            let pays = game.pays(&table, w)?;
            let an = Analyzer::new(game);
            let t = Instant::now();
            let c = strategy::compare(&an, &pays, w.bet, &a, &b);
            let pct = |r: f64| r * 100.0;
            println!("Table B: {} [{}], {}", table.name, table.id, describe_wager(w));
            println!("  optimal          {:.6}%", pct(c.optimal_b.to_f64()));
            println!("  B's strategy     {:.6}%", pct(c.b_on_b.to_f64()));
            println!(
                "  A's strategy     {:.6}%  ({:.6} credits/hand less than B's)",
                pct(c.a_on_b.to_f64()),
                c.cost_credits()
            );
            println!("\nChanges from A to B (applied in order; effect = change in return on table B):");
            let line = |i: Option<usize>| i.map_or("-".to_string(), |i| (i + 1).to_string());
            for ch in &c.changes {
                let kind = match ch.kind {
                    strategy::ChangeKind::Removed => "removed",
                    strategy::ChangeKind::Added => "added",
                    strategy::ChangeKind::Moved => "moved",
                };
                println!(
                    "  {kind:<8} A {:>3}  B {:>3}  {:+.6}%  {:+.6} cr/hand  {}",
                    line(ch.from),
                    line(ch.to),
                    pct(ch.delta),
                    ch.delta * w.bet as f64,
                    ch.rule
                );
            }
            let sum: f64 = c.changes.iter().map(|ch| ch.delta).sum();
            println!(
                "  total {:+.6}% ({} changes, {:.0} ms)",
                pct(sum),
                c.changes.len(),
                ms(t)
            );
            println!(
                "\nHands played differently: {:.4}% of deals, by deciding rule (A -> B):",
                pct(c.differ)
            );
            let held = |hand: &str, m: u8| -> String {
                hand.split(' ')
                    .enumerate()
                    .map(|(i, c)| if m >> i & 1 == 1 { c.to_string() } else { "--".into() })
                    .collect::<Vec<_>>()
                    .join(" ")
            };
            for d in c.differences.iter().take(20) {
                println!(
                    "  {:>8.4}%  {:+.6} cr/hand  {} -> {}",
                    pct(d.prob),
                    d.effect,
                    c.a.rules[d.a_rule],
                    c.b.rules[d.b_rule]
                );
                println!(
                    "             e.g. {}: A {}, B {} ({:+.4} credits)",
                    d.hand,
                    held(&d.hand, d.a_hold),
                    held(&d.hand, d.b_hold),
                    d.gain
                );
            }
            Ok(true)
        }
        "tidy" => {
            // Re-tidies and re-evaluates strategy files in place (no
            // regeneration). Play must not change.
            for file in &o.positional[1..] {
                let text = std::fs::read_to_string(file).map_err(|e| format!("{file}: {e}"))?;
                let head = |k: &str| {
                    text.lines()
                        .find_map(|l| l.strip_prefix(&format!("# {k}: ")))
                        .map(str::to_string)
                };
                let table = builtin_paytable(
                    &head("paytable").ok_or(format!("{file}: no paytable header"))?,
                )?;
                let game = builtin_game(&table.game)?;
                let bet: u32 = head("bet")
                    .ok_or("no bet header")?
                    .parse()
                    .map_err(|_| "bad bet header")?;
                let tier = head("tier").and_then(|t| t.split(' ').next().map(str::to_string));
                let tier = tier.map(|t| strategy::tier(&t)).transpose()?;
                let pays = game.pays_for_bet(&table, bet)?;
                let an = Analyzer::new(game);
                let old = Strategy::parse(&text)?;
                let new = strategy::natural_order(&an, &pays, &strategy::tidy(&old));
                let r_old = strategy::evaluate(&an, &pays, bet, &old);
                let r_new = strategy::evaluate(&an, &pays, bet, &new);
                if r_old.ret != r_new.ret || r_old.holds != r_new.holds || !r_new.is_complete() {
                    return Err(format!("{file}: tidy changed play"));
                }
                let meta = FileMeta {
                    game: &an.game.def.id,
                    paytable: &table.id,
                    bet,
                    progressive: None,
                    tier: tier.as_ref(),
                };
                std::fs::write(file, strategy::render_file(&new, &r_new, &meta))
                    .map_err(|e| format!("{file}: {e}"))?;
                println!(
                    "{file}: {} -> {} lines, play unchanged",
                    old.rules.len(),
                    new.rules.len()
                );
            }
            Ok(true)
        }
        "play" => {
            let file = o.positional.get(1).ok_or("strategy play needs a FILE")?;
            let text = std::fs::read_to_string(file).map_err(|e| format!("{file}: {e}"))?;
            let strat = Strategy::parse(&text)?;
            let (game, _) = load_table(o)?;
            let hand = game.deck().parse_hand(&o.positional[2..].join(" "))?;
            let p = strategy::play(&game, &strat, &hand);
            let d = game.deck();
            let held: Vec<String> = (0..5)
                .map(|i| {
                    if p.hold >> i & 1 == 1 {
                        d.card_name(hand[i])
                    } else {
                        "--".into()
                    }
                })
                .collect();
            match p.rule {
                Some(i) => println!("{}   rule {}: {}", held.join(" "), i + 1, strat.rules[i]),
                None => println!("no rule matches"),
            }
            for (i, m) in strategy::matching_rules(&game, &strat, &hand) {
                let h: Vec<String> = (0..5)
                    .map(|j| {
                        if m >> j & 1 == 1 {
                            d.card_name(hand[j])
                        } else {
                            "--".into()
                        }
                    })
                    .collect();
                println!(
                    "  matches rule {:>2}: {:<40} {}",
                    i + 1,
                    strat.rules[i].to_string(),
                    h.join(" ")
                );
            }
            Ok(true)
        }
        _ => Err(format!("unknown strategy command '{sub}'\n{USAGE}")),
    }
}

fn cmd_list() {
    let tables = builtin_paytables();
    for g in builtin_games() {
        println!(
            "{} — {} (label \"{}\", max bet {})",
            g.def.id, g.def.name, g.def.label, g.def.max_bet
        );
        for t in tables.iter().filter(|t| t.game == g.def.id) {
            println!("    {:<30} {}", t.id, t.name);
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first() else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let o = match parse_opts(&args[1..]) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("error: {e}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let res = match cmd.as_str() {
        "analyze" => cmd_analyze(&o).map(|_| true),
        "holds" => cmd_holds(&o).map(|_| true),
        "verify" => cmd_verify(&o),
        "strategy" => cmd_strategy(&o),
        "list" => {
            cmd_list();
            Ok(true)
        }
        "help" | "--help" | "-h" => {
            println!("{USAGE}");
            Ok(true)
        }
        _ => Err(format!("unknown command '{cmd}'\n{USAGE}")),
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
