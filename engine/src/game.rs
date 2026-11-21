//! Game definitions and pay tables, loaded from JSON data.
//!
//! A game definition lists its deck and its pay lines in priority order; the
//! first line that matches a final hand is the one paid. A pay table assigns
//! a per-coin payout to every line, with optional totals that override the
//! per-coin amount at max bet (the 4000-credit royal).

use crate::cards::{Card, Deck, parse_rank};
use crate::eval::{HandInfo, HandKind, classify};
use serde::Deserialize;
use std::collections::BTreeMap;

/// Upper bound on pay lines + 1 ("no win") a game may have.
pub const MAX_CATEGORIES: usize = 32;

#[derive(Clone, Debug, Deserialize)]
pub struct DeckDef {
    pub ranks: Vec<String>,
    pub suits: u8,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayLineDef {
    pub id: String,
    pub name: String,
    pub hand: HandKind,
    /// Pair (or two pair: higher pair) must be at least this rank.
    #[serde(default)]
    pub min_rank: Option<String>,
    /// Four of a kind: the quad rank must be one of these.
    #[serde(default)]
    pub quad_ranks: Option<Vec<String>>,
    /// Four of a kind: the fifth card's rank must be one of these.
    #[serde(default)]
    pub kicker_ranks: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameDef {
    pub id: String,
    pub name: String,
    /// Default display label (generic; the player may rename it).
    pub label: String,
    pub deck: DeckDef,
    pub max_bet: u32,
    pub lines: Vec<PayLineDef>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayTable {
    pub id: String,
    pub game: String,
    pub name: String,
    /// Per-coin payout for each line id.
    pub pays: BTreeMap<String, i64>,
    /// Total credits paid at max bet, overriding per-coin × bet.
    #[serde(default)]
    pub max_bet_pays: BTreeMap<String, i64>,
}

#[derive(Clone, Debug)]
struct LineMatcher {
    kind: HandKind,
    min_rank: u8,
    quad_mask: u16,
    kicker_mask: u16,
}

impl LineMatcher {
    fn matches(&self, h: &HandInfo) -> bool {
        h.kind == self.kind
            && h.primary >= self.min_rank
            && (self.quad_mask >> h.primary) & 1 == 1
            && (h.kind != HandKind::FourOfAKind || (self.kicker_mask >> h.secondary) & 1 == 1)
    }
}

/// A compiled game: deck plus pay-line matchers. Category ids are line
/// indices `0..lines.len()`; `no_win()` (= lines.len()) means nothing paid.
#[derive(Clone, Debug)]
pub struct Game {
    pub def: GameDef,
    deck: Deck,
    matchers: Vec<LineMatcher>,
}

fn rank_mask(list: &Option<Vec<String>>) -> Result<u16, String> {
    match list {
        None => Ok(0xFFFF),
        Some(v) => {
            let mut m = 0u16;
            for s in v {
                m |= 1 << parse_rank(s)?;
            }
            Ok(m)
        }
    }
}

impl Game {
    pub fn from_json(json: &str) -> Result<Game, String> {
        let def: GameDef =
            serde_json::from_str(json).map_err(|e| format!("game definition: {e}"))?;
        Game::new(def)
    }

    pub fn new(def: GameDef) -> Result<Game, String> {
        let ranks = def
            .deck
            .ranks
            .iter()
            .map(|s| parse_rank(s))
            .collect::<Result<Vec<_>, _>>()?;
        let deck = Deck::new(ranks, def.deck.suits)?;
        Game::with_deck(def, deck)
    }

    /// Same pay lines on a different (e.g. reduced) deck. Used for verification.
    pub fn with_deck(def: GameDef, deck: Deck) -> Result<Game, String> {
        if def.lines.is_empty() || def.lines.len() >= MAX_CATEGORIES {
            return Err(format!("a game needs 1..{} pay lines", MAX_CATEGORIES - 1));
        }
        if def.max_bet == 0 {
            return Err("max_bet must be at least 1".into());
        }
        let mut matchers = Vec::new();
        for (i, l) in def.lines.iter().enumerate() {
            if def.lines[..i].iter().any(|o| o.id == l.id) {
                return Err(format!("duplicate line id '{}'", l.id));
            }
            matchers.push(LineMatcher {
                kind: l.hand,
                min_rank: match &l.min_rank {
                    Some(r) => parse_rank(r)?,
                    None => 0,
                },
                quad_mask: rank_mask(&l.quad_ranks)?,
                kicker_mask: rank_mask(&l.kicker_ranks)?,
            });
        }
        Ok(Game {
            def,
            deck,
            matchers,
        })
    }

    pub fn deck(&self) -> &Deck {
        &self.deck
    }

    pub fn num_lines(&self) -> usize {
        self.matchers.len()
    }

    /// Number of outcome categories: every pay line plus "no win".
    pub fn num_categories(&self) -> usize {
        self.matchers.len() + 1
    }

    pub fn no_win(&self) -> usize {
        self.matchers.len()
    }

    pub fn category_name(&self, cat: usize) -> &str {
        if cat == self.no_win() {
            "No win"
        } else {
            &self.def.lines[cat].name
        }
    }

    pub fn hand_info(&self, hand: &[Card]) -> HandInfo {
        let d = &self.deck;
        classify(
            [
                d.rank(hand[0]),
                d.rank(hand[1]),
                d.rank(hand[2]),
                d.rank(hand[3]),
                d.rank(hand[4]),
            ],
            [
                d.suit(hand[0]),
                d.suit(hand[1]),
                d.suit(hand[2]),
                d.suit(hand[3]),
                d.suit(hand[4]),
            ],
        )
    }

    /// Outcome category of a final five-card hand.
    #[inline]
    pub fn category(&self, hand: &[Card]) -> usize {
        let info = self.hand_info(hand);
        self.matchers
            .iter()
            .position(|m| m.matches(&info))
            .unwrap_or(self.matchers.len())
    }

    /// Credits paid per category for a given bet (1..=max_bet). The last
    /// entry ("no win") is always 0.
    pub fn pays_for_bet(&self, table: &PayTable, bet: u32) -> Result<Vec<i64>, String> {
        if table.game != self.def.id {
            return Err(format!(
                "pay table '{}' is for game '{}', not '{}'",
                table.id, table.game, self.def.id
            ));
        }
        if bet == 0 || bet > self.def.max_bet {
            return Err(format!("bet must be 1..={}", self.def.max_bet));
        }
        for k in table.pays.keys().chain(table.max_bet_pays.keys()) {
            if !self.def.lines.iter().any(|l| &l.id == k) {
                return Err(format!("pay table '{}' names unknown line '{k}'", table.id));
            }
        }
        let mut pays = Vec::with_capacity(self.num_categories());
        for l in &self.def.lines {
            let per_coin = *table.pays.get(&l.id).ok_or_else(|| {
                format!("pay table '{}' has no pay for line '{}'", table.id, l.id)
            })?;
            let p = match table.max_bet_pays.get(&l.id) {
                Some(&total) if bet == self.def.max_bet => total,
                _ => per_coin * bet as i64,
            };
            if p < 0 {
                return Err(format!("negative pay for line '{}'", l.id));
            }
            pays.push(p);
        }
        pays.push(0);
        Ok(pays)
    }
}

pub fn parse_paytable(json: &str) -> Result<PayTable, String> {
    serde_json::from_str(json).map_err(|e| format!("pay table: {e}"))
}

// ---- Built-in data -------------------------------------------------------

pub const BUILTIN_GAMES: &[(&str, &str)] = &[(
    "jacks-or-better",
    include_str!("../../data/games/jacks-or-better.json"),
)];

pub const BUILTIN_PAYTABLES: &[(&str, &str)] = &[(
    "jacks-or-better-9-6",
    include_str!("../../data/paytables/jacks-or-better-9-6.json"),
)];

pub fn builtin_game(id: &str) -> Result<Game, String> {
    let (_, json) = BUILTIN_GAMES
        .iter()
        .find(|(gid, _)| *gid == id)
        .ok_or_else(|| format!("unknown game '{id}'"))?;
    Game::from_json(json)
}

pub fn builtin_paytable(id: &str) -> Result<PayTable, String> {
    let (_, json) = BUILTIN_PAYTABLES
        .iter()
        .find(|(pid, _)| *pid == id)
        .ok_or_else(|| format!("unknown pay table '{id}'"))?;
    parse_paytable(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_load_and_ids_match() {
        for (id, _) in BUILTIN_GAMES {
            assert_eq!(builtin_game(id).unwrap().def.id, *id);
        }
        for (id, _) in BUILTIN_PAYTABLES {
            let t = builtin_paytable(id).unwrap();
            assert_eq!(t.id, *id);
            let g = builtin_game(&t.game).unwrap();
            for bet in 1..=g.def.max_bet {
                g.pays_for_bet(&t, bet).unwrap();
            }
        }
    }

    #[test]
    fn job_categories_and_pays() {
        let g = builtin_game("jacks-or-better").unwrap();
        let t = builtin_paytable("jacks-or-better-9-6").unwrap();
        let d = g.deck().clone();
        let cat = |s: &str| g.category(&d.parse_hand(s).unwrap());
        let pays5 = g.pays_for_bet(&t, 5).unwrap();
        let pays1 = g.pays_for_bet(&t, 1).unwrap();
        assert_eq!(pays5[cat("As Ks Qs Js Ts")], 4000);
        assert_eq!(pays1[cat("As Ks Qs Js Ts")], 250);
        assert_eq!(pays5[cat("Js Jh 2c 3d 4s")], 5);
        assert_eq!(pays5[cat("Ts Th 2c 3d 4s")], 0);
        assert_eq!(cat("Ts Th 2c 3d 4s"), g.no_win());
        assert_eq!(pays5[cat("2s 2h 3c 3d 4s")], 10);
        assert_eq!(pays5[cat("2s 3s 4s 5s 7s")], 30);
        assert!(g.pays_for_bet(&t, 0).is_err());
        assert!(g.pays_for_bet(&t, 6).is_err());
    }
}
