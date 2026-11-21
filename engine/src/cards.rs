//! Cards and decks.
//!
//! A card is a `u8` id in `0..deck.size()`. Id = rank_index * suits + suit,
//! so ids sort by rank first. Rank *values* are 2..=14 (ace = 14).
//! Decks may be reduced (fewer ranks or suits) for verification runs.

use crate::combin::MAX_DECK;

pub type Card = u8;

pub const RANK_CHARS: &[u8; 13] = b"23456789TJQKA";
pub const SUIT_CHARS: &[u8; 4] = b"cdhs";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Deck {
    ranks: Vec<u8>,
    suits: u8,
    rank_of: Vec<u8>,
    suit_of: Vec<u8>,
}

impl Deck {
    /// `ranks`: distinct rank values (2..=14), any order. `suits`: 1..=4.
    pub fn new(mut ranks: Vec<u8>, suits: u8) -> Result<Deck, String> {
        ranks.sort_unstable();
        ranks.dedup();
        if ranks.is_empty() || ranks.iter().any(|&r| !(2..=14).contains(&r)) {
            return Err("deck ranks must be values 2..=14".into());
        }
        if !(1..=4).contains(&suits) {
            return Err("deck must have 1..=4 suits".into());
        }
        let size = ranks.len() * suits as usize;
        if size > MAX_DECK || size < 10 {
            return Err(format!("deck size {size} out of range 10..={MAX_DECK}"));
        }
        let mut rank_of = Vec::with_capacity(size);
        let mut suit_of = Vec::with_capacity(size);
        for &r in &ranks {
            for s in 0..suits {
                rank_of.push(r);
                suit_of.push(s);
            }
        }
        Ok(Deck {
            ranks,
            suits,
            rank_of,
            suit_of,
        })
    }

    pub fn standard() -> Deck {
        Deck::new((2..=14).collect(), 4).unwrap()
    }

    pub fn size(&self) -> usize {
        self.rank_of.len()
    }
    pub fn suits(&self) -> u8 {
        self.suits
    }
    pub fn ranks(&self) -> &[u8] {
        &self.ranks
    }
    #[inline]
    pub fn rank(&self, c: Card) -> u8 {
        self.rank_of[c as usize]
    }
    #[inline]
    pub fn suit(&self, c: Card) -> u8 {
        self.suit_of[c as usize]
    }
    /// Index of the card's rank within this deck's rank list.
    #[inline]
    pub fn rank_index(&self, c: Card) -> usize {
        c as usize / self.suits as usize
    }

    pub fn card(&self, rank: u8, suit: u8) -> Option<Card> {
        let ri = self.ranks.iter().position(|&r| r == rank)?;
        if suit >= self.suits {
            return None;
        }
        Some((ri * self.suits as usize + suit as usize) as Card)
    }

    pub fn card_name(&self, c: Card) -> String {
        let r = RANK_CHARS[(self.rank(c) - 2) as usize] as char;
        let s = SUIT_CHARS[self.suit(c) as usize] as char;
        format!("{r}{s}")
    }

    pub fn parse_card(&self, s: &str) -> Result<Card, String> {
        let s = s.trim();
        if !s.is_ascii() {
            return Err(format!("bad card '{s}'"));
        }
        let (rs, ss) = if s.len() == 3 && s.starts_with("10") {
            ("T", &s[2..])
        } else if s.len() == 2 {
            (&s[..1], &s[1..])
        } else {
            return Err(format!("bad card '{s}'"));
        };
        let rank = parse_rank(rs)?;
        let sc = ss.to_ascii_lowercase().as_bytes()[0];
        let suit = SUIT_CHARS
            .iter()
            .position(|&x| x == sc)
            .ok_or_else(|| format!("bad suit in '{s}'"))? as u8;
        self.card(rank, suit)
            .ok_or_else(|| format!("card '{s}' is not in this deck"))
    }

    /// Parses five distinct cards separated by spaces or commas.
    pub fn parse_hand(&self, s: &str) -> Result<[Card; 5], String> {
        let parts: Vec<&str> = s
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|p| !p.is_empty())
            .collect();
        if parts.len() != 5 {
            return Err(format!("expected 5 cards, got {}", parts.len()));
        }
        let mut hand = [0u8; 5];
        for (i, p) in parts.iter().enumerate() {
            hand[i] = self.parse_card(p)?;
        }
        validate_hand(self, &hand)?;
        Ok(hand)
    }

    pub fn hand_name(&self, hand: &[Card]) -> String {
        hand.iter()
            .map(|&c| self.card_name(c))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Parses a rank symbol ("2".."9", "T"/"10", "J", "Q", "K", "A") to its value.
pub fn parse_rank(s: &str) -> Result<u8, String> {
    let s = s.trim().to_ascii_uppercase();
    if s == "10" {
        return Ok(10);
    }
    if s.len() == 1 {
        if let Some(i) = RANK_CHARS.iter().position(|&x| x == s.as_bytes()[0]) {
            return Ok(i as u8 + 2);
        }
    }
    Err(format!("bad rank '{s}'"))
}

pub fn validate_hand(deck: &Deck, hand: &[Card]) -> Result<(), String> {
    if hand.len() != 5 {
        return Err("a hand has exactly 5 cards".into());
    }
    for (i, &c) in hand.iter().enumerate() {
        if c as usize >= deck.size() {
            return Err(format!("card id {c} out of range"));
        }
        if hand[..i].contains(&c) {
            return Err(format!("duplicate card {}", deck.card_name(c)));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_round_trip() {
        let d = Deck::standard();
        for c in 0..52u8 {
            assert_eq!(d.parse_card(&d.card_name(c)).unwrap(), c);
        }
        assert_eq!(d.parse_card("10h").unwrap(), d.parse_card("Th").unwrap());
        assert!(d.parse_hand("As Ks Qs Js As").is_err());
        assert!(d.parse_hand("As Ks Qs Js").is_err());
        assert!(d.parse_card("Xs").is_err());
    }

    #[test]
    fn reduced_deck() {
        let d = Deck::new(vec![10, 11, 12, 13, 14], 4).unwrap();
        assert_eq!(d.size(), 20);
        assert!(d.parse_card("9s").is_err());
        assert_eq!(d.rank(d.parse_card("Ah").unwrap()), 14);
    }
}
