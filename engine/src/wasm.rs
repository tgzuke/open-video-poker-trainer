//! Thin WebAssembly bindings. All logic lives in the native modules.

use crate::analysis::Analyzer;
use crate::cards::validate_hand;
use crate::game::{Game, PayTable, builtin_game, builtin_paytable, parse_paytable};
use wasm_bindgen::prelude::*;

fn js(e: String) -> JsError {
    JsError::new(&e)
}

/// Engine for one game + pay table. Building it precomputes the draw tables.
#[wasm_bindgen]
pub struct Engine {
    analyzer: Analyzer,
    paytable: PayTable,
}

#[wasm_bindgen]
impl Engine {
    /// Engine for built-in game/pay table ids.
    pub fn builtin(paytable_id: &str) -> Result<Engine, JsError> {
        let paytable = builtin_paytable(paytable_id).map_err(js)?;
        let game = builtin_game(&paytable.game).map_err(js)?;
        Ok(Engine::from_parts(game, paytable))
    }

    /// Engine from JSON game definition and pay table.
    #[wasm_bindgen(js_name = fromJson)]
    pub fn from_json(game_json: &str, paytable_json: &str) -> Result<Engine, JsError> {
        let game = Game::from_json(game_json).map_err(js)?;
        let paytable = parse_paytable(paytable_json).map_err(js)?;
        game.pays_for_bet(&paytable, 1).map_err(js)?;
        Ok(Engine::from_parts(game, paytable))
    }

    fn from_parts(game: Game, paytable: PayTable) -> Engine {
        Engine {
            analyzer: Analyzer::new(game),
            paytable,
        }
    }

    /// EV in credits of each of the 32 holds (bit i keeps card i).
    #[wasm_bindgen(js_name = holdEvs)]
    pub fn hold_evs(&self, cards: &[u8], bet: u32) -> Result<Vec<f64>, JsError> {
        let game = &self.analyzer.game;
        validate_hand(game.deck(), cards).map_err(js)?;
        let pays = game.pays_for_bet(&self.paytable, bet).map_err(js)?;
        let hand = [cards[0], cards[1], cards[2], cards[3], cards[4]];
        let evs = self.analyzer.hold_evs(&hand, &pays);
        Ok((0..32).map(|m| evs.ev(m)).collect())
    }

    /// Optimal-play return (credits returned per credit bet).
    #[wasm_bindgen(js_name = optimalReturn)]
    pub fn optimal_return(&self, bet: u32) -> Result<f64, JsError> {
        let pays = self
            .analyzer
            .game
            .pays_for_bet(&self.paytable, bet)
            .map_err(js)?;
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
}
