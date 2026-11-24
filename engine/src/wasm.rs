//! Thin WebAssembly bindings. All logic lives in the native modules.

use crate::analysis::Analyzer;
use crate::cards::validate_hand;
use crate::game::{
    Game, PayTable, Wager, builtin_game, builtin_games, builtin_paytable, builtin_paytables,
    parse_paytable,
};
use crate::strategy::{self, Strategy};
use wasm_bindgen::prelude::*;

fn js(e: String) -> JsError {
    JsError::new(&e)
}

/// JSON catalog of built-in games (with their lines) and preset pay tables.
#[wasm_bindgen]
pub fn catalog() -> String {
    serde_json::json!({
        "games": builtin_games().iter().map(|g| &g.def).collect::<Vec<_>>(),
        "paytables": builtin_paytables(),
    })
    .to_string()
}

/// Engine for one game. Building it precomputes the draw tables (~0.2 s);
/// switching pay tables, bet or progressive afterwards needs no rebuild.
#[wasm_bindgen]
pub struct Engine {
    analyzer: Analyzer,
    paytable: PayTable,
    /// Strategy the trainer checks against (SPEC §5).
    trainer: Option<Strategy>,
}

fn progressive(p: Option<f64>) -> Result<Option<i64>, JsError> {
    match p {
        None => Ok(None),
        Some(v) if v.is_finite() && v >= 0.0 && v.fract() == 0.0 && v < 9e15 => Ok(Some(v as i64)),
        Some(v) => Err(js(format!(
            "progressive must be whole credits ≥ 0, got {v}"
        ))),
    }
}

#[wasm_bindgen]
impl Engine {
    /// Engine for a preset pay table id (and its game).
    pub fn builtin(paytable_id: &str) -> Result<Engine, JsError> {
        let paytable = builtin_paytable(paytable_id).map_err(js)?;
        let game = builtin_game(&paytable.game).map_err(js)?;
        Ok(Engine {
            analyzer: Analyzer::new(game),
            paytable,
            trainer: None,
        })
    }

    /// Engine from a JSON game definition and pay table.
    #[wasm_bindgen(js_name = fromJson)]
    pub fn from_json(game_json: &str, paytable_json: &str) -> Result<Engine, JsError> {
        let game = Game::from_json(game_json).map_err(js)?;
        let paytable = parse_paytable(paytable_json).map_err(js)?;
        game.validate_paytable(&paytable).map_err(js)?;
        Ok(Engine {
            analyzer: Analyzer::new(game),
            paytable,
            trainer: None,
        })
    }

    #[wasm_bindgen(js_name = gameId)]
    pub fn game_id(&self) -> String {
        self.analyzer.game.def.id.clone()
    }

    #[wasm_bindgen(js_name = paytableId)]
    pub fn paytable_id(&self) -> String {
        self.paytable.id.clone()
    }

    /// Switch to another preset of the same game.
    #[wasm_bindgen(js_name = setPaytable)]
    pub fn set_paytable(&mut self, paytable_id: &str) -> Result<(), JsError> {
        let t = builtin_paytable(paytable_id).map_err(js)?;
        self.analyzer.game.validate_paytable(&t).map_err(js)?;
        self.paytable = t;
        Ok(())
    }

    /// Switch to a custom pay table (JSON) for the same game.
    #[wasm_bindgen(js_name = setCustomPaytable)]
    pub fn set_custom_paytable(&mut self, json: &str) -> Result<(), JsError> {
        let t = parse_paytable(json).map_err(js)?;
        self.analyzer.game.validate_paytable(&t).map_err(js)?;
        self.paytable = t;
        Ok(())
    }

    /// Credits paid per outcome category (pay lines in order, then "no win").
    pub fn pays(&self, bet: u32, progressive_royal: Option<f64>) -> Result<Vec<f64>, JsError> {
        Ok(self
            .pays_i64(bet, progressive_royal)?
            .into_iter()
            .map(|p| p as f64)
            .collect())
    }

    fn pays_i64(&self, bet: u32, prog: Option<f64>) -> Result<Vec<i64>, JsError> {
        let w = Wager {
            bet,
            progressive: progressive(prog)?,
        };
        self.analyzer.game.pays(&self.paytable, w).map_err(js)
    }

    /// EV in credits of each of the 32 holds (bit i keeps card i).
    #[wasm_bindgen(js_name = holdEvs)]
    pub fn hold_evs(
        &self,
        cards: &[u8],
        bet: u32,
        progressive_royal: Option<f64>,
    ) -> Result<Vec<f64>, JsError> {
        validate_hand(self.analyzer.game.deck(), cards).map_err(js)?;
        let pays = self.pays_i64(bet, progressive_royal)?;
        let hand = [cards[0], cards[1], cards[2], cards[3], cards[4]];
        let evs = self.analyzer.hold_evs(&hand, &pays);
        Ok((0..32).map(|m| evs.ev(m)).collect())
    }

    /// Optimal-play return (credits returned per credit bet).
    #[wasm_bindgen(js_name = optimalReturn)]
    pub fn optimal_return(&self, bet: u32, progressive_royal: Option<f64>) -> Result<f64, JsError> {
        let pays = self.pays_i64(bet, progressive_royal)?;
        Ok(self.analyzer.optimal(&pays, bet).result.ret.to_f64())
    }

    #[wasm_bindgen(js_name = maxBet)]
    pub fn max_bet(&self) -> u32 {
        self.analyzer.game.def.max_bet
    }

    #[wasm_bindgen(js_name = parseHand)]
    pub fn parse_hand(&self, s: &str) -> Result<Vec<u8>, JsError> {
        Ok(self
            .analyzer
            .game
            .deck()
            .parse_hand(s)
            .map_err(js)?
            .to_vec())
    }

    #[wasm_bindgen(js_name = cardName)]
    pub fn card_name(&self, c: u8) -> String {
        self.analyzer.game.deck().card_name(c)
    }

    /// Exact evaluation of a strategy (text) as JSON: return, optimal,
    /// loss, completeness, and per-rule stats.
    #[wasm_bindgen(js_name = evaluateStrategy)]
    pub fn evaluate_strategy(
        &self,
        text: &str,
        bet: u32,
        progressive_royal: Option<f64>,
    ) -> Result<String, JsError> {
        let strat = Strategy::parse(text).map_err(js)?;
        let pays = self.pays_i64(bet, progressive_royal)?;
        let r = strategy::evaluate(&self.analyzer, &pays, bet, &strat);
        Ok(report_json(&strat, &r).to_string())
    }

    /// Generates one tier ("beginner" | "intermediate" | "expert"); `seed`
    /// is the lower tier's text (or empty); `max_lines` overrides the tier's
    /// line cap. Returns the strategy file text.
    #[wasm_bindgen(js_name = generateStrategy)]
    pub fn generate_strategy(
        &self,
        tier: &str,
        bet: u32,
        progressive_royal: Option<f64>,
        seed: &str,
        max_lines: Option<u32>,
    ) -> Result<String, JsError> {
        let mut tier = strategy::tier(tier).map_err(js)?;
        if let Some(n) = max_lines {
            tier = tier.with_max_lines(n as usize).map_err(js)?;
        }
        let pays = self.pays_i64(bet, progressive_royal)?;
        let seed = if seed.trim().is_empty() {
            None
        } else {
            Some(Strategy::parse(seed).map_err(js)?)
        };
        let g = strategy::generate(&self.analyzer, &pays, &tier, &seed.iter().collect::<Vec<_>>());
        let r = strategy::evaluate(&self.analyzer, &pays, bet, &g.strategy);
        if !r.is_complete() {
            return Err(js("generated strategy is incomplete".into()));
        }
        let meta = strategy::FileMeta {
            game: &self.analyzer.game.def.id,
            paytable: &self.paytable.id,
            bet,
            progressive: progressive(progressive_royal)?,
            tier: Some(&tier),
        };
        Ok(strategy::render_file(&g.strategy, &r, &meta))
    }

    /// Sets (or with empty text clears) the strategy the trainer checks.
    #[wasm_bindgen(js_name = setTrainerStrategy)]
    pub fn set_trainer_strategy(&mut self, text: &str) -> Result<(), JsError> {
        self.trainer = if text.trim().is_empty() {
            None
        } else {
            Some(Strategy::parse(text).map_err(js)?)
        };
        Ok(())
    }

    /// Everything the trainer needs to judge any hold of a dealt hand, as
    /// JSON: EVs (credits), exact-tie groups, best hold, and with a trainer
    /// strategy set, its play, the matching rules and each hold's rule
    /// distance (null = off-strategy). See `strategy::trainer`.
    #[wasm_bindgen(js_name = dealCheck)]
    pub fn deal_check(
        &self,
        cards: &[u8],
        bet: u32,
        progressive_royal: Option<f64>,
    ) -> Result<String, JsError> {
        let game = &self.analyzer.game;
        validate_hand(game.deck(), cards).map_err(js)?;
        let pays = self.pays_i64(bet, progressive_royal)?;
        let hand = [cards[0], cards[1], cards[2], cards[3], cards[4]];
        let evs = self.analyzer.hold_evs(&hand, &pays);
        let ev_list: Vec<f64> = (0..32).map(|m| evs.ev(m)).collect();
        let tie: Vec<u8> = (0..32)
            .map(|m| {
                (0..=m)
                    .find(|&o| evs.cmp(m, o) == std::cmp::Ordering::Equal)
                    .unwrap() as u8
            })
            .collect();
        let best = evs.best();
        let Some(strat) = &self.trainer else {
            return Ok(
                serde_json::json!({ "evs": ev_list, "tie": tie, "best": best, "strategy": null })
                    .to_string(),
            );
        };
        let c = strategy::deal_check(game, strat, &hand, evs);
        // Indices are written lines; texts name the single rule on the line
        // that applies (shorter, and what the player should have used).
        let text = |i: usize| strat.rules[i].to_string();
        Ok(serde_json::json!({
            "evs": ev_list,
            "tie": c.tie,
            "best": c.best,
            "strategy": {
                "rule": c.rule,
                "ruleText": c.matching_rules.first().map(|&i| text(i)),
                "hold": c.hold,
                "matching": c.matching.iter().zip(&c.matching_rules).map(|(&(l, m), &i)| serde_json::json!({ "rule": l, "text": text(i), "hold": m })).collect::<Vec<_>>(),
                "describes": c.describes,
                "describesText": c.describes_rule.map(|r| r.map(text)),
                "distance": c.distance,
            }
        })
        .to_string())
    }

    /// Pay table comparison (SPEC §4.5) on this engine's pay table (table
    /// B): strategy A's text against strategy B's, as JSON. See
    /// `strategy::compare`.
    #[wasm_bindgen(js_name = compareStrategies)]
    pub fn compare_strategies(
        &self,
        text_a: &str,
        text_b: &str,
        bet: u32,
        progressive_royal: Option<f64>,
    ) -> Result<String, JsError> {
        let a = Strategy::parse(text_a).map_err(|e| js(format!("strategy A: {e}")))?;
        let b = Strategy::parse(text_b).map_err(|e| js(format!("strategy B: {e}")))?;
        let pays = self.pays_i64(bet, progressive_royal)?;
        let c = strategy::compare(&self.analyzer, &pays, bet, &a, &b);
        let kind = |k| match k {
            strategy::ChangeKind::Removed => "removed",
            strategy::ChangeKind::Added => "added",
            strategy::ChangeKind::Moved => "moved",
        };
        let texts = |s: &Strategy| s.rules.iter().map(|r| r.to_string()).collect::<Vec<_>>();
        Ok(serde_json::json!({
            "aOnB": c.a_on_b.to_f64(),
            "bOnB": c.b_on_b.to_f64(),
            "optimalB": c.optimal_b.to_f64(),
            "a": texts(&c.a),
            "b": texts(&c.b),
            "changes": c.changes.iter().map(|ch| serde_json::json!({
                "kind": kind(ch.kind),
                "rule": ch.rule.to_string(),
                "from": ch.from,
                "to": ch.to,
                "delta": ch.delta,
            })).collect::<Vec<_>>(),
            "differ": c.differ,
            "differences": c.differences.iter().take(60).map(|d| serde_json::json!({
                "aRule": d.a_rule,
                "bRule": d.b_rule,
                "prob": d.prob,
                "effect": d.effect,
                "hand": d.hand,
                "aHold": d.a_hold,
                "bHold": d.b_hold,
                "gain": d.gain,
            })).collect::<Vec<_>>(),
            "differenceCount": c.differences.len(),
        })
        .to_string())
    }

    /// How a strategy plays a hand, as JSON: deciding line (0-based or
    /// null), hold mask, and every matching line with its hold, in order.
    #[wasm_bindgen(js_name = playStrategy)]
    pub fn play_strategy(&self, text: &str, cards: &[u8]) -> Result<String, JsError> {
        let strat = Strategy::parse(text).map_err(js)?;
        let game = &self.analyzer.game;
        validate_hand(game.deck(), cards).map_err(js)?;
        let hand = [cards[0], cards[1], cards[2], cards[3], cards[4]];
        let p = strategy::play(game, &strat, &hand);
        // Lines, not rules: a joined line is one entry (its first match).
        let line_of = strat.line_of();
        let mut seen = std::collections::HashSet::new();
        let matching: Vec<serde_json::Value> = strategy::matching_rules(game, &strat, &hand)
            .into_iter()
            .filter(|&(i, _)| seen.insert(line_of[i]))
            .map(|(i, m)| serde_json::json!({ "rule": line_of[i], "hold": m }))
            .collect();
        let rule = p.rule.map(|i| line_of[i]);
        Ok(serde_json::json!({ "rule": rule, "hold": p.hold, "matching": matching }).to_string())
    }
}

fn report_json(strat: &Strategy, r: &strategy::Report) -> serde_json::Value {
    serde_json::json!({
        "return": r.ret.to_f64(),
        "optimal": r.optimal.to_f64(),
        "lossCredits": r.loss_credits(),
        "lossPoints": r.loss_points(),
        "complete": r.is_complete(),
        "undefined": r.undefined.iter().take(20).map(|p| &p.hand).collect::<Vec<_>>(),
        "undefinedCount": r.undefined.len(),
        "ambiguous": r.ambiguous.iter().take(20).map(|p| &p.hand).collect::<Vec<_>>(),
        "ambiguousCount": r.ambiguous.len(),
        "worst": r.worst.iter().take(10).map(|(l, hand, rule, hold, best)| serde_json::json!({
            "loss": l, "hand": hand, "rule": rule, "hold": hold, "best": best,
        })).collect::<Vec<_>>(),
        "rules": strat.line_texts().into_iter().zip(&r.rules).map(|(text, st)| serde_json::json!({
            "text": text,
            "fires": st.fires,
            "disagrees": st.disagrees,
            "loss": st.loss,
        })).collect::<Vec<_>>(),
    })
}

/// Checks one strategy line (one rule, or several joined with ", "): its
/// canonical text, or an error. Comments and
/// blank lines are not rules.
#[wasm_bindgen(js_name = parseRule)]
pub fn parse_rule(text: &str) -> Result<String, JsError> {
    let body = text.split('#').next().unwrap_or("").trim();
    if body.is_empty() {
        return Err(js("empty rule".into()));
    }
    strategy::rule::parse_line(body)
        .map(|rules| {
            rules
                .iter()
                .map(|r| r.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .map_err(js)
}

/// Lightweight rules for the game screen: hand categories and pays, with no
/// draw tables (cheap to build; safe on the UI thread).
#[wasm_bindgen]
pub struct Rules {
    game: Game,
    paytable: PayTable,
}

#[wasm_bindgen]
impl Rules {
    pub fn builtin(paytable_id: &str) -> Result<Rules, JsError> {
        let paytable = builtin_paytable(paytable_id).map_err(js)?;
        let game = builtin_game(&paytable.game).map_err(js)?;
        Ok(Rules { game, paytable })
    }

    /// Same game, custom pay table (JSON).
    #[wasm_bindgen(js_name = withPaytable)]
    pub fn with_paytable(paytable_json: &str) -> Result<Rules, JsError> {
        let paytable = parse_paytable(paytable_json).map_err(js)?;
        let game = builtin_game(&paytable.game).map_err(js)?;
        game.validate_paytable(&paytable).map_err(js)?;
        Ok(Rules { game, paytable })
    }

    /// Outcome category of five cards: pay line index, or `noWin()`.
    pub fn category(&self, cards: &[u8]) -> Result<u32, JsError> {
        validate_hand(self.game.deck(), cards).map_err(js)?;
        Ok(self.game.category(cards) as u32)
    }

    #[wasm_bindgen(js_name = noWin)]
    pub fn no_win(&self) -> u32 {
        self.game.no_win() as u32
    }

    /// Credits paid per category (lines, then "no win" = 0).
    pub fn pays(&self, bet: u32, progressive_royal: Option<f64>) -> Result<Vec<f64>, JsError> {
        let w = Wager {
            bet,
            progressive: progressive(progressive_royal)?,
        };
        Ok(self
            .game
            .pays(&self.paytable, w)
            .map_err(js)?
            .into_iter()
            .map(|p| p as f64)
            .collect())
    }

    #[wasm_bindgen(js_name = maxBet)]
    pub fn max_bet(&self) -> u32 {
        self.game.def.max_bet
    }

    #[wasm_bindgen(js_name = deckSize)]
    pub fn deck_size(&self) -> u32 {
        self.game.deck().size() as u32
    }

    /// Rank value (2..=14) and suit (0..=3, c d h s) of a card id.
    pub fn rank(&self, card: u8) -> u8 {
        self.game.deck().rank(card)
    }
    pub fn suit(&self, card: u8) -> u8 {
        self.game.deck().suit(card)
    }

    #[wasm_bindgen(js_name = lineNames)]
    pub fn line_names(&self) -> Vec<String> {
        self.game.def.lines.iter().map(|l| l.name.clone()).collect()
    }

    #[wasm_bindgen(js_name = gameId)]
    pub fn game_id(&self) -> String {
        self.game.def.id.clone()
    }

    #[wasm_bindgen(js_name = paytableId)]
    pub fn paytable_id(&self) -> String {
        self.paytable.id.clone()
    }
}
