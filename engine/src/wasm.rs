//! Thin WebAssembly bindings. All logic lives in the native modules.

use crate::analysis::Analyzer;
use crate::cards::validate_hand;
use crate::game::{
    Game, PayTable, Wager, builtin_game, builtin_games, builtin_paytable, builtin_paytables,
    parse_paytable,
};
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
}

fn progressive(p: Option<f64>) -> Result<Option<i64>, JsError> {
    match p {
        None => Ok(None),
        Some(v) if v.is_finite() && v >= 0.0 && v.fract() == 0.0 && v < 9e15 => Ok(Some(v as i64)),
        Some(v) => Err(js(format!("progressive must be whole credits ≥ 0, got {v}"))),
    }
}

#[wasm_bindgen]
impl Engine {
    /// Engine for a preset pay table id (and its game).
    pub fn builtin(paytable_id: &str) -> Result<Engine, JsError> {
        let paytable = builtin_paytable(paytable_id).map_err(js)?;
        let game = builtin_game(&paytable.game).map_err(js)?;
        Ok(Engine { analyzer: Analyzer::new(game), paytable })
    }

    /// Engine from a JSON game definition and pay table.
    #[wasm_bindgen(js_name = fromJson)]
    pub fn from_json(game_json: &str, paytable_json: &str) -> Result<Engine, JsError> {
        let game = Game::from_json(game_json).map_err(js)?;
        let paytable = parse_paytable(paytable_json).map_err(js)?;
        game.validate_paytable(&paytable).map_err(js)?;
        Ok(Engine { analyzer: Analyzer::new(game), paytable })
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
        Ok(self.pays_i64(bet, progressive_royal)?.into_iter().map(|p| p as f64).collect())
    }

    fn pays_i64(&self, bet: u32, prog: Option<f64>) -> Result<Vec<i64>, JsError> {
        let w = Wager { bet, progressive: progressive(prog)? };
        self.analyzer.game.pays(&self.paytable, w).map_err(js)
    }

    /// EV in credits of each of the 32 holds (bit i keeps card i).
    #[wasm_bindgen(js_name = holdEvs)]
    pub fn hold_evs(&self, cards: &[u8], bet: u32, progressive_royal: Option<f64>) -> Result<Vec<f64>, JsError> {
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
        Ok(self.analyzer.game.deck().parse_hand(s).map_err(js)?.to_vec())
    }

    #[wasm_bindgen(js_name = cardName)]
    pub fn card_name(&self, c: u8) -> String {
        self.analyzer.game.deck().card_name(c)
    }
}
