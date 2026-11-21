//! The SPEC §3.3 verification suite, shared by `cargo test` and `ovp verify`.
//!
//! Each check returns `Ok(detail)` or `Err(description of the first failure)`.

use crate::analysis::Ratio;
use crate::analysis::{Analyzer, optimal_brute_force};
use crate::cards::{Card, Deck};
use crate::draw::{NUM_HOLDS, brute_force_hold_counts};
use crate::game::{Game, PayTable, Wager};

/// Small deterministic PRNG (SplitMix64) so runs are reproducible.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    pub fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
    /// Five distinct random cards (unsorted, as a player would be dealt).
    pub fn hand(&mut self, deck: &Deck) -> [Card; 5] {
        let mut h = [0u8; 5];
        let mut i = 0;
        while i < 5 {
            let c = self.below(deck.size()) as u8;
            if !h[..i].contains(&c) {
                h[i] = c;
                i += 1;
            }
        }
        h
    }
    pub fn permutation(&mut self, n: usize) -> Vec<u8> {
        let mut p: Vec<u8> = (0..n as u8).collect();
        for i in (1..n).rev() {
            p.swap(i, self.below(i + 1));
        }
        p
    }
}

pub type Check = Result<String, String>;

/// Fast path == brute force, category by category, on random hands.
pub fn fast_matches_brute_force(an: &Analyzer, samples: usize, seed: u64) -> Check {
    let mut rng = Rng::new(seed);
    let deck = an.game.deck();
    for _ in 0..samples {
        let h = rng.hand(deck);
        let fast = an.tables.hold_counts(&an.game, &h);
        let slow = brute_force_hold_counts(&an.game, &h);
        if fast != slow {
            return Err(format!(
                "fast path differs from brute force on {}",
                deck.hand_name(&h)
            ));
        }
    }
    Ok(format!("{samples} random hands × 32 holds identical"))
}

/// For every hold of every class, outcome counts are non-negative and sum
/// to the number of possible draws; full-game category probabilities sum to 1.
pub fn probabilities_sum_to_one(an: &Analyzer, pays: &[i64], bet: u32) -> Check {
    let ncat = an.game.num_categories();
    for cl in &an.classes {
        let hc = an.tables.hold_counts(&an.game, &cl.cards);
        for m in 0..NUM_HOLDS {
            let row = &hc.counts[m][..ncat];
            if row.iter().any(|&x| x < 0) || row.iter().sum::<i64>() != hc.draws[m] {
                return Err(format!(
                    "hold {m:05b} of {} has counts {row:?} vs {} draws",
                    an.game.deck().hand_name(&cl.cards),
                    hc.draws[m]
                ));
            }
        }
    }
    let r = an.optimal(pays, bet).result;
    let total = r.category_probs.iter().fold((0i128, 1i128), |(n, d), p| {
        let l = crate::combin::lcm_i128(d, p.den);
        (n * (l / d) + p.num * (l / p.den), l)
    });
    if total.0 != total.1 {
        return Err(format!(
            "category probabilities sum to {}/{}",
            total.0, total.1
        ));
    }
    let n = an.game.deck().size();
    let w: i128 = an.classes.iter().map(|c| c.weight as i128).sum();
    if w != crate::combin::choose(n, 5) as i128 || r.deals != w {
        return Err(format!("class weights sum to {w}, expected C({n},5)"));
    }
    Ok(format!(
        "{} classes × 32 holds; class weights sum to C({n},5); outcome probabilities sum to exactly 1",
        an.classes.len()
    ))
}

/// Relabelling suits never changes any hold's outcome counts.
pub fn suit_permutation_invariance(an: &Analyzer, samples: usize, seed: u64) -> Check {
    let mut rng = Rng::new(seed);
    let deck = an.game.deck();
    let suits = deck.suits() as usize;
    for _ in 0..samples {
        let h = rng.hand(deck);
        let perm = rng.permutation(suits);
        let ph: [Card; 5] = h.map(|c| {
            deck.card(deck.rank(c), perm[deck.suit(c) as usize])
                .unwrap()
        });
        // Same positions hold the corresponding cards, so masks line up.
        let a = an.tables.hold_counts(&an.game, &h);
        let b = an.tables.hold_counts(&an.game, &ph);
        if a != b {
            return Err(format!(
                "{} and {} (suits permuted {perm:?}) differ",
                deck.hand_name(&h),
                deck.hand_name(&ph)
            ));
        }
    }
    Ok(format!(
        "{samples} random hands, random suit permutations: identical"
    ))
}

/// Full-game return: suit-symmetry path == every-deal path == fully brute
/// force (no tables), exactly. Brute force only runs if `brute` is set.
pub fn symmetry_matches_full(an: &Analyzer, pays: &[i64], bet: u32, brute: bool) -> Check {
    let sym = an.optimal(pays, bet).result;
    let full = an.optimal_without_symmetry(pays, bet);
    if sym.ret != full.ret {
        return Err(format!(
            "symmetry {:?} vs all deals {:?}",
            sym.ret, full.ret
        ));
    }
    let mut detail = format!(
        "{} classes vs {} deals: return {:.10} identical",
        an.classes.len(),
        full.deals,
        sym.ret.to_f64()
    );
    if brute {
        let bf = optimal_brute_force(&an.game, pays, bet);
        if bf.ret != sym.ret {
            return Err(format!(
                "symmetry {:?} vs brute force {:?}",
                sym.ret, bf.ret
            ));
        }
        detail.push_str("; brute force identical");
    }
    // A suit-symmetric policy, too ("hold the best-EV hold" is one; use a
    // cruder one so this differs from the optimal path).
    let game = &an.game;
    let policy = |h: &[Card; 5]| -> usize {
        // Hold every card that pairs another card; otherwise hold nothing.
        let mut m = 0;
        for i in 0..5 {
            for j in 0..5 {
                if i != j && game.deck().rank(h[i]) == game.deck().rank(h[j]) {
                    m |= 1 << i;
                }
            }
        }
        m
    };
    let p_sym = an.policy_return(pays, bet, policy);
    let mut acc_num = 0i128;
    let mut acc_den = 1i128;
    let all: Vec<u8> = (0..game.deck().size() as u8).collect();
    crate::combin::for_each_combination(&all, 5, |h| {
        let h = [h[0], h[1], h[2], h[3], h[4]];
        let evs = an.hold_evs(&h, pays);
        let m = policy(&h);
        let (n, d) = (evs.numer[m] as i128, evs.draws[m] as i128);
        let l = crate::combin::lcm_i128(acc_den, d);
        acc_num = acc_num * (l / acc_den) + n * (l / d);
        acc_den = l;
    });
    let p_full = crate::analysis::Ratio::new(acc_num, acc_den * full.deals * bet as i128);
    if p_sym.ret != p_full {
        return Err(format!(
            "policy return: symmetry {:?} vs all deals {:?}",
            p_sym.ret, p_full
        ));
    }
    detail.push_str("; strategy (keep pairs) return identical");
    Ok(detail)
}

/// Reduced decks used for the exhaustive cross-checks. Fully brute-forcing
/// (no tables) is affordable up to `BRUTE_MAX_DECK` cards.
pub const BRUTE_MAX_DECK: usize = 20;

pub fn reduced_games(base: &Game) -> Vec<Game> {
    let decks = [
        Deck::new(vec![10, 11, 12, 13, 14], 4).unwrap(), // 20 cards: royals, high quads
        Deck::new(vec![2, 3, 4, 5, 14], 4).unwrap(), // 20 cards: wheel, aces/low quads + kickers
        Deck::new(vec![2, 3, 4, 5, 11, 13, 14], 3).unwrap(), // 21 cards, 3 suits
        Deck::new(vec![8, 9, 10, 11, 12, 13, 14], 4).unwrap(), // 28 cards
    ];
    decks
        .into_iter()
        .map(|d| Game::with_deck(base.def.clone(), d).unwrap())
        .collect()
}

/// Bet size and progressive amount change results correctly:
/// - below max bet every pay is per-coin × bet, so the return is identical;
/// - a progressive equal to the base max-bet royal changes nothing, and a
///   progressive below max bet is ignored;
/// - raising the progressive by Δ, with the old optimal holds kept, raises
///   the return by exactly P(royal) × Δ / bet; re-optimising can only add more,
///   and the royal can only become more likely.
pub fn wager_checks(an: &Analyzer, table: &PayTable) -> Check {
    let g = &an.game;
    let max = g.def.max_bet;
    let pays = |w: Wager| g.pays(table, w);
    let base_low = an.optimal(&pays(Wager::bet(1))?, 1).result.ret;
    for bet in 2..max {
        let r = an.optimal(&pays(Wager::bet(bet))?, bet).result.ret;
        if r != base_low {
            return Err(format!(
                "bet {bet} return {r:?} differs from bet 1 {base_low:?}"
            ));
        }
    }
    let base_pays = pays(Wager::bet(max))?;
    let base = an.optimal(&base_pays, max);
    let Some(line) = g.def.progressive_line.as_deref() else {
        return Ok(format!(
            "bets 1..{} identical; no progressive line",
            max - 1
        ));
    };
    let li = g.line_index(line).unwrap();
    let base_amount = base_pays[li];
    let same = an.optimal(
        &pays(Wager {
            bet: max,
            progressive: Some(base_amount),
        })?,
        max,
    );
    if same.result.ret != base.result.ret {
        return Err("progressive equal to the base amount changed the return".into());
    }
    if max > 1
        && pays(Wager {
            bet: max - 1,
            progressive: Some(base_amount * 3),
        })? != pays(Wager::bet(max - 1))?
    {
        return Err("progressive changed pays below max bet".into());
    }
    let mut prev_ret = base.result.ret;
    let mut prev_p = base.result.category_probs[li];
    let mut detail = Vec::new();
    for delta in [1i64, 500, 2_000, 10_000] {
        let amount = base_amount + delta;
        let new_pays = pays(Wager {
            bet: max,
            progressive: Some(amount),
        })?;
        let fixed = an.holds_return(&new_pays, max, &base.best_holds).ret;
        let expect = base
            .result
            .ret
            .add(base.result.category_probs[li].mul(Ratio::new(delta as i128, max as i128)));
        if fixed != expect {
            return Err(format!(
                "progressive {amount}: fixed-hold return {fixed:?}, expected {expect:?}"
            ));
        }
        let opt = an.optimal(&new_pays, max).result;
        let (r, p) = (opt.ret, opt.category_probs[li]);
        if r.to_f64() < fixed.to_f64()
            || r.to_f64() <= prev_ret.to_f64()
            || p.to_f64() < prev_p.to_f64()
        {
            return Err(format!(
                "progressive {amount}: return or royal frequency went the wrong way"
            ));
        }
        detail.push(format!("{amount}: {:.4}%", r.to_f64() * 100.0));
        prev_ret = r;
        prev_p = p;
    }
    Ok(format!(
        "bets 1..{} identical ({:.4}%), max bet {:.4}%; progressive {}",
        max - 1,
        base_low.to_f64() * 100.0,
        base.result.ret.to_f64() * 100.0,
        detail.join(", ")
    ))
}
