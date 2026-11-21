//! Game definitions and pay tables, loaded from JSON data.
//!
//! A game definition lists its deck and its pay lines in priority order; the
//! first line that matches a final hand is the one paid. A pay table assigns
//! a per-coin payout to every line, with optional totals that override the
//! per-coin amount at max bet (the 4000-credit royal). A progressive amount,
//! if given, replaces the game's progressive line (the royal) at max bet.
//!
//! Built-in data is every file under `data/games` and `data/paytables`,
//! registered at compile time by `build.rs`.

use crate::cards::{Card, Deck, parse_rank};
use crate::eval::{HandInfo, HandKind, classify};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Upper bound on pay lines + 1 ("no win") a game may have.
pub const MAX_CATEGORIES: usize = 32;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DeckDef {
    pub ranks: Vec<String>,
    pub suits: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PayLineDef {
    pub id: String,
    pub name: String,
    pub hand: HandKind,
    /// Pair (or two pair: higher pair) must be at least this rank.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_rank: Option<String>,
    /// Four of a kind: the quad rank must be one of these.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quad_ranks: Option<Vec<String>>,
    /// Four of a kind: the fifth card's rank must be one of these.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kicker_ranks: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GameDef {
    pub id: String,
    pub name: String,
    /// Default display label (generic; the player may rename it).
    pub label: String,
    pub deck: DeckDef,
    pub max_bet: u32,
    /// Line whose max-bet payout a progressive amount replaces.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progressive_line: Option<String>,
    pub lines: Vec<PayLineDef>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PayTable {
    pub id: String,
    /// Game id. May be omitted inside a library file (inherited).
    #[serde(default)]
    pub game: String,
    pub name: String,
    /// Per-coin payout for each line id.
    pub pays: BTreeMap<String, i64>,
    /// Total credits paid at max bet, overriding per-coin × bet.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub max_bet_pays: BTreeMap<String, i64>,
    /// Informational only (SPEC §3.3): a commonly published return.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_return_pct: Option<f64>,
}

/// A file holding several pay tables for one game.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayTableLibrary {
    pub game: String,
    pub tables: Vec<PayTable>,
}

/// What the player is wagering: coins bet, and an optional progressive
/// amount (total credits) for the progressive line at max bet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Wager {
    pub bet: u32,
    pub progressive: Option<i64>,
}

impl Wager {
    pub fn bet(bet: u32) -> Wager {
        Wager {
            bet,
            progressive: None,
        }
    }
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
            if (l.quad_ranks.is_some() || l.kicker_ranks.is_some())
                && l.hand != HandKind::FourOfAKind
            {
                return Err(format!(
                    "line '{}': quad/kicker ranks only apply to four_of_a_kind",
                    l.id
                ));
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
        if let Some(p) = &def.progressive_line {
            if !def.lines.iter().any(|l| &l.id == p) {
                return Err(format!("progressive_line '{p}' is not a line"));
            }
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

    pub fn line_index(&self, id: &str) -> Option<usize> {
        self.def.lines.iter().position(|l| l.id == id)
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

    /// Checks a pay table belongs to this game and pays every line exactly
    /// once with a non-negative amount.
    pub fn validate_paytable(&self, table: &PayTable) -> Result<(), String> {
        if table.game != self.def.id {
            return Err(format!(
                "pay table '{}' is for game '{}', not '{}'",
                table.id, table.game, self.def.id
            ));
        }
        for k in table.pays.keys().chain(table.max_bet_pays.keys()) {
            if self.line_index(k).is_none() {
                return Err(format!("pay table '{}' names unknown line '{k}'", table.id));
            }
        }
        for l in &self.def.lines {
            match table.pays.get(&l.id) {
                None => {
                    return Err(format!(
                        "pay table '{}' has no pay for line '{}'",
                        table.id, l.id
                    ));
                }
                Some(&p) if p < 0 => return Err(format!("negative pay for line '{}'", l.id)),
                _ => {}
            }
        }
        if let Some((k, _)) = table.max_bet_pays.iter().find(|(_, v)| **v < 0) {
            return Err(format!("negative max-bet pay for line '{k}'"));
        }
        Ok(())
    }

    /// Credits paid per category for a wager. The last entry ("no win") is 0.
    pub fn pays(&self, table: &PayTable, wager: Wager) -> Result<Vec<i64>, String> {
        self.validate_paytable(table)?;
        let bet = wager.bet;
        if bet == 0 || bet > self.def.max_bet {
            return Err(format!("bet must be 1..={}", self.def.max_bet));
        }
        let prog_line = match (wager.progressive, &self.def.progressive_line) {
            (None, _) => None,
            (Some(_), None) => return Err("this game has no progressive line".into()),
            (Some(v), Some(_)) if v < 0 => {
                return Err("progressive amount must be non-negative".into());
            }
            (Some(_), Some(id)) => self.line_index(id),
        };
        let mut pays = Vec::with_capacity(self.num_categories());
        for (i, l) in self.def.lines.iter().enumerate() {
            let per_coin = table.pays[&l.id];
            let p = if bet == self.def.max_bet && prog_line == Some(i) {
                wager.progressive.unwrap()
            } else {
                match table.max_bet_pays.get(&l.id) {
                    Some(&total) if bet == self.def.max_bet => total,
                    _ => per_coin * bet as i64,
                }
            };
            pays.push(p);
        }
        pays.push(0);
        Ok(pays)
    }

    /// `pays` with no progressive.
    pub fn pays_for_bet(&self, table: &PayTable, bet: u32) -> Result<Vec<i64>, String> {
        self.pays(table, Wager::bet(bet))
    }
}

/// Parses a standalone pay table (custom tables). `game` must be present.
pub fn parse_paytable(json: &str) -> Result<PayTable, String> {
    let t: PayTable = serde_json::from_str(json).map_err(|e| format!("pay table: {e}"))?;
    if t.game.is_empty() {
        return Err("pay table: missing \"game\"".into());
    }
    Ok(t)
}

/// Parses a library file; each table inherits the library's game id.
pub fn parse_paytable_library(json: &str) -> Result<Vec<PayTable>, String> {
    let lib: PayTableLibrary =
        serde_json::from_str(json).map_err(|e| format!("pay table library: {e}"))?;
    lib.tables
        .into_iter()
        .map(|mut t| {
            if !t.game.is_empty() && t.game != lib.game {
                return Err(format!("table '{}' names a different game", t.id));
            }
            t.game = lib.game.clone();
            Ok(t)
        })
        .collect()
}

/// Applies `line=value` overrides (per-coin pays) to make a custom variant.
/// `max:line=value` sets a max-bet total instead.
pub fn with_overrides(base: &PayTable, overrides: &[(String, i64)]) -> PayTable {
    let mut t = base.clone();
    let mut tag = Vec::new();
    for (k, v) in overrides {
        if let Some(line) = k.strip_prefix("max:") {
            t.max_bet_pays.insert(line.to_string(), *v);
        } else {
            t.pays.insert(k.clone(), *v);
        }
        tag.push(format!("{k}={v}"));
    }
    if !overrides.is_empty() {
        t.id = format!("{}+custom", base.id);
        t.name = format!("{} ({})", base.name, tag.join(", "));
        t.published_return_pct = None;
    }
    t
}

// ---- Built-in data -------------------------------------------------------

mod builtin_data {
    include!(concat!(env!("OUT_DIR"), "/builtin_data.rs"));
}

pub fn builtin_games() -> Vec<Game> {
    builtin_data::GAMES
        .iter()
        .map(|(name, json)| {
            Game::from_json(json).unwrap_or_else(|e| panic!("data/games/{name}: {e}"))
        })
        .collect()
}

/// Every preset pay table, grouped by game in data-file order.
pub fn builtin_paytables() -> Vec<PayTable> {
    builtin_data::PAYTABLES
        .iter()
        .flat_map(|(name, json)| {
            parse_paytable_library(json).unwrap_or_else(|e| panic!("data/paytables/{name}: {e}"))
        })
        .collect()
}

pub fn builtin_game(id: &str) -> Result<Game, String> {
    builtin_games()
        .into_iter()
        .find(|g| g.def.id == id)
        .ok_or_else(|| format!("unknown game '{id}'"))
}

pub fn builtin_paytable(id: &str) -> Result<PayTable, String> {
    builtin_paytables()
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("unknown pay table '{id}'"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn job() -> (Game, PayTable) {
        (
            builtin_game("jacks-or-better").unwrap(),
            builtin_paytable("jacks-or-better-9-6").unwrap(),
        )
    }

    #[test]
    fn every_preset_is_valid_and_ids_are_unique() {
        let games = builtin_games();
        let tables = builtin_paytables();
        let gids: HashSet<_> = games.iter().map(|g| g.def.id.clone()).collect();
        assert_eq!(gids.len(), games.len());
        let tids: HashSet<_> = tables.iter().map(|t| t.id.clone()).collect();
        assert_eq!(tids.len(), tables.len());
        for t in &tables {
            let g = games
                .iter()
                .find(|g| g.def.id == t.game)
                .expect("game exists");
            for bet in 1..=g.def.max_bet {
                g.pays_for_bet(t, bet).unwrap();
            }
        }
        for id in [
            "jacks-or-better",
            "bonus-poker",
            "double-bonus",
            "double-double-bonus",
        ] {
            assert!(gids.contains(id), "{id}");
            assert!(tables.iter().any(|t| t.game == id), "no tables for {id}");
        }
    }

    #[test]
    fn job_categories_and_pays() {
        let (g, t) = job();
        let d = g.deck().clone();
        let cat = |s: &str| g.category(&d.parse_hand(s).unwrap());
        let pays5 = g.pays_for_bet(&t, 5).unwrap();
        let pays1 = g.pays_for_bet(&t, 1).unwrap();
        let pays3 = g.pays_for_bet(&t, 3).unwrap();
        assert_eq!(pays5[cat("As Ks Qs Js Ts")], 4000);
        assert_eq!(pays1[cat("As Ks Qs Js Ts")], 250);
        assert_eq!(pays3[cat("As Ks Qs Js Ts")], 750);
        assert_eq!(pays3[cat("2s 2h 3c 3d 4s")], 6);
        assert_eq!(pays5[cat("Js Jh 2c 3d 4s")], 5);
        assert_eq!(pays5[cat("Ts Th 2c 3d 4s")], 0);
        assert_eq!(cat("Ts Th 2c 3d 4s"), g.no_win());
        assert_eq!(pays5[cat("2s 2h 3c 3d 4s")], 10);
        assert_eq!(pays5[cat("2s 3s 4s 5s 7s")], 30);
        assert!(g.pays_for_bet(&t, 0).is_err());
        assert!(g.pays_for_bet(&t, 6).is_err());
    }

    #[test]
    fn bonus_quads_and_ddb_kickers() {
        let ddb = builtin_game("double-double-bonus").unwrap();
        let t = builtin_paytable("double-double-bonus-9-6").unwrap();
        let p = ddb.pays_for_bet(&t, 1).unwrap();
        let d = ddb.deck().clone();
        let pay = |s: &str| p[ddb.category(&d.parse_hand(s).unwrap())];
        assert_eq!(pay("As Ah Ad Ac 2h"), 400);
        assert_eq!(pay("As Ah Ad Ac 4h"), 400);
        assert_eq!(pay("As Ah Ad Ac 5h"), 160);
        assert_eq!(pay("As Ah Ad Ac Kh"), 160);
        assert_eq!(pay("3s 3h 3d 3c Ah"), 160);
        assert_eq!(pay("3s 3h 3d 3c 2h"), 160);
        assert_eq!(pay("3s 3h 3d 3c 4h"), 160);
        assert_eq!(pay("2s 2h 2d 2c 5h"), 80);
        assert_eq!(pay("5s 5h 5d 5c Ah"), 50);
        assert_eq!(pay("Ks Kh Kd Kc 2h"), 50);
        assert_eq!(pay("Ks Kh Kd 2c 2h"), 9);
        assert_eq!(pay("Ks Kh 3d 2c 2h"), 1); // two pair pays 1 in DDB
        assert_eq!(pay("As Ks Qs Js Ts"), 250);

        let bp = builtin_game("bonus-poker").unwrap();
        let t = builtin_paytable("bonus-poker-8-5").unwrap();
        let p = bp.pays_for_bet(&t, 1).unwrap();
        let pay = |s: &str| p[bp.category(&d.parse_hand(s).unwrap())];
        assert_eq!(pay("As Ah Ad Ac 2h"), 80);
        assert_eq!(pay("4s 4h 4d 4c Ah"), 40);
        assert_eq!(pay("Qs Qh Qd Qc Ah"), 25);
        assert_eq!(pay("Qs Qh 4d 4c Ah"), 2);

        let db = builtin_game("double-bonus").unwrap();
        let t = builtin_paytable("double-bonus-10-7").unwrap();
        let p = db.pays_for_bet(&t, 1).unwrap();
        let pay = |s: &str| p[db.category(&d.parse_hand(s).unwrap())];
        assert_eq!(pay("As Ah Ad Ac 2h"), 160);
        assert_eq!(pay("2s 2h 2d 2c 3h"), 80);
        assert_eq!(pay("9s 9h 9d 9c 3h"), 50);
        assert_eq!(pay("9s Th Jd Qc Kh"), 5);
        assert_eq!(pay("2s 7s 9s Js Ks"), 7);
    }

    #[test]
    fn progressive_replaces_royal_at_max_bet_only() {
        let (g, t) = job();
        let royal = g.line_index("royal_flush").unwrap();
        let w = |bet, p| Wager {
            bet,
            progressive: Some(p),
        };
        assert_eq!(g.pays(&t, w(5, 6123)).unwrap()[royal], 6123);
        assert_eq!(g.pays(&t, w(4, 6123)).unwrap()[royal], 1000);
        // Everything else unchanged.
        let a = g.pays(&t, w(5, 6123)).unwrap();
        let b = g.pays_for_bet(&t, 5).unwrap();
        assert!((0..a.len()).all(|i| i == royal || a[i] == b[i]));
        assert!(g.pays(&t, w(5, -1)).is_err());
    }

    #[test]
    fn custom_tables_are_validated() {
        let (g, t) = job();
        let c = with_overrides(
            &t,
            &[("full_house".into(), 8), ("max:royal_flush".into(), 4700)],
        );
        let p = g.pays_for_bet(&c, 5).unwrap();
        assert_eq!(p[g.line_index("full_house").unwrap()], 40);
        assert_eq!(p[g.line_index("royal_flush").unwrap()], 4700);
        assert!(c.name.contains("full_house=8"));

        let bad = with_overrides(&t, &[("fullhouse".into(), 8)]);
        assert!(
            g.pays_for_bet(&bad, 5)
                .unwrap_err()
                .contains("unknown line")
        );
        let neg = with_overrides(&t, &[("flush".into(), -1)]);
        assert!(g.pays_for_bet(&neg, 5).is_err());
        let mut missing = t.clone();
        missing.pays.remove("straight");
        assert!(g.pays_for_bet(&missing, 5).unwrap_err().contains("no pay"));
        let other = builtin_paytable("bonus-poker-8-5").unwrap();
        assert!(g.pays_for_bet(&other, 5).is_err());

        // Round trip through JSON, as a saved custom table would be.
        let json = serde_json::to_string(&c).unwrap();
        let back = parse_paytable(&json).unwrap();
        assert_eq!(g.pays_for_bet(&back, 5).unwrap(), p);
        assert!(parse_paytable(r#"{"id":"x","name":"x","pays":{}}"#).is_err());
    }
}
