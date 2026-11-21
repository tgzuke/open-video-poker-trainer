//! Strategy rule language: a ranked list of hold patterns.
//!
//! One rule per line, best first. `#` starts a comment. Grammar:
//!
//! ```text
//! rule      := pattern { option }
//! pattern   := "discard everything"
//!            | "royal flush" | "straight flush" | "full house" | "flush" | "straight"
//!            | PAT { "," PAT }      several pat hands on one line, e.g.
//!                                   "royal flush, straight flush, four of a kind, full house"
//!            | "four of a kind" [RANKS] ["kicker" RANKS]
//!            | "three of a kind" [RANKS] ["kicker" RANKS]
//!            | "two pair"
//!            | "pair" [RANKS]
//!            | N "to a" ("royal" | "straight flush" | "flush" | "straight")   N = 3 or 4
//!            | CARDS ["suited" | "unsuited"]       e.g. "QJ suited", "KQJ unsuited", "K"
//!            | N "high card" ["s"] ["suited" | "unsuited"]   N cards, all high, nothing else
//! option    := "w=" N         straights (5-rank windows) the held ranks fit in
//!            | "h=" N         held high cards (ranks that pay as a pair)
//!            | ("fp" | "sp") ("=" | ">=") N
//!                fp: discarded cards of the held suit (flush penalty)
//!                sp: discarded cards that fit a straight with the held ranks
//!            | "prefer low"   when several card sets match, keep the lowest ranks
//! RANKS     := e.g. "A", "J-A", "2-4", "A,2-4"
//! ```
//!
//! Pairs, two pair and three of a kind match ranks as dealt: "pair" is a
//! rank dealt exactly twice (it may be part of a full house or two pair),
//! never two cards out of trips or quads.
//!
//! A hand is played by the first rule that matches any subset of it. If a
//! rule matches several subsets, it keeps the highest ranks (or lowest with
//! `prefer low`), then the fewest fp, then the fewest sp. Any choice left is
//! between suit-swapped card sets; if their EVs are exactly equal they are
//! equivalent (SPEC §3.1), otherwise the analyzer reports the hand ambiguous.

use crate::cards::{RANK_CHARS, parse_rank};
use crate::eval::HandKind;
use std::fmt;

/// Draw families for held cards of distinct ranks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Family {
    /// Suited, all ranks T or higher.
    Royal,
    /// Suited, fits at least one straight, not a royal draw.
    StraightFlush,
    /// Suited, fits no straight.
    Flush,
    /// Not all one suit, fits at least one straight.
    Straight,
}

impl Family {
    fn word(self) -> &'static str {
        match self {
            Family::Royal => "royal",
            Family::StraightFlush => "straight flush",
            Family::Flush => "flush",
            Family::Straight => "straight",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Pattern {
    Nothing,
    /// Hold all five: the dealt hand is exactly this kind.
    Made(HandKind),
    Pair {
        ranks: u16,
    },
    TwoPair,
    Trips {
        ranks: u16,
        kicker: Option<u16>,
    },
    Quads {
        ranks: u16,
        kicker: Option<u16>,
    },
    Draw {
        family: Family,
        n: u8,
        w: Option<u8>,
        h: Option<u8>,
    },
    /// Exactly these distinct ranks; `suited` is None for a single card.
    Exact {
        ranks: u16,
        suited: Option<bool>,
    },
    /// N distinct high cards (ranks that pay as a pair); `suited` None = either.
    High {
        n: u8,
        suited: Option<bool>,
    },
    /// Any of several pat hands (bits: `PAT_WORDS` order); quads hold four.
    Pat(u8),
}

/// Pat hands, in the order they are written on a combined line.
pub const PAT_WORDS: [&str; 6] = [
    "royal flush",
    "straight flush",
    "four of a kind",
    "full house",
    "flush",
    "straight",
];

/// Bit in a `Pattern::Pat` mask for a made hand kind (quads: bit 2).
pub fn pat_bit(k: HandKind) -> Option<u8> {
    match k {
        HandKind::RoyalFlush => Some(0),
        HandKind::StraightFlush => Some(1),
        HandKind::FourOfAKind => Some(2),
        HandKind::FullHouse => Some(3),
        HandKind::Flush => Some(4),
        HandKind::Straight => Some(5),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Cmp {
    Eq(u8),
    Ge(u8),
}

impl Cmp {
    #[inline]
    pub fn test(self, v: u8) -> bool {
        match self {
            Cmp::Eq(n) => v == n,
            Cmp::Ge(n) => v >= n,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Rule {
    pub pattern: Pattern,
    pub fp: Option<Cmp>,
    pub sp: Option<Cmp>,
    pub prefer_low: bool,
}

impl Rule {
    pub fn new(pattern: Pattern) -> Rule {
        Rule {
            pattern,
            fp: None,
            sp: None,
            prefer_low: false,
        }
    }
    pub fn has_qualifier(&self) -> bool {
        self.fp.is_some() || self.sp.is_some()
    }
}

/// All rank values 2..=14 as a bitmask (bit r set for rank r).
pub const ALL_RANKS: u16 = 0x7FFC;

pub fn rank_char(r: u8) -> char {
    RANK_CHARS[(r - 2) as usize] as char
}

/// Formats a rank set compactly: "A", "J-A", "2-4", "A,2-4".
pub fn format_ranks(mask: u16) -> String {
    let mut parts = Vec::new();
    // Aces first when the set also has low cards but not K (reads "A,2-4").
    let ace_first = mask & (1 << 14) != 0 && mask & (1 << 13) == 0 && mask & 0x1FFC != 0;
    let body = if ace_first { mask & !(1 << 14) } else { mask };
    if ace_first {
        parts.push("A".to_string());
    }
    let mut r = 2u8;
    while r <= 14 {
        if body & (1 << r) != 0 {
            let start = r;
            while r < 14 && body & (1 << (r + 1)) != 0 {
                r += 1;
            }
            parts.push(if start == r {
                rank_char(r).to_string()
            } else {
                format!("{}-{}", rank_char(start), rank_char(r))
            });
        }
        r += 1;
    }
    parts.join(",")
}

pub fn parse_ranks(s: &str) -> Result<u16, String> {
    let mut m = 0u16;
    for part in s.split(',') {
        let part = part.trim();
        if let Some((a, b)) = part.split_once('-') {
            let (a, b) = (parse_rank(a)?, parse_rank(b)?);
            if a > b {
                return Err(format!("bad rank range '{part}'"));
            }
            for r in a..=b {
                m |= 1 << r;
            }
        } else {
            m |= 1 << parse_rank(part)?;
        }
    }
    if m == 0 {
        return Err("empty rank set".into());
    }
    Ok(m)
}

/// "AKQJ" style, highest first.
pub fn format_cards(mask: u16) -> String {
    (2..=14u8)
        .rev()
        .filter(|r| mask & (1 << r) != 0)
        .map(rank_char)
        .collect()
}

fn parse_cards(s: &str) -> Option<u16> {
    let mut m = 0u16;
    for ch in s.chars() {
        let r = parse_rank(&ch.to_string()).ok()?;
        if m & (1 << r) != 0 {
            return None;
        }
        m |= 1 << r;
    }
    if m == 0 || s.chars().count() > 4 {
        None
    } else {
        Some(m)
    }
}

fn made_word(k: HandKind) -> &'static str {
    match k {
        HandKind::RoyalFlush => "royal flush",
        HandKind::StraightFlush => "straight flush",
        HandKind::FullHouse => "full house",
        HandKind::Flush => "flush",
        HandKind::Straight => "straight",
        _ => "?",
    }
}

impl fmt::Display for Rule {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let ranks = |m: u16| {
            if m == ALL_RANKS {
                String::new()
            } else {
                format!(" {}", format_ranks(m))
            }
        };
        let kicker = |k: Option<u16>| {
            k.map(|m| format!(" kicker {}", format_ranks(m)))
                .unwrap_or_default()
        };
        match self.pattern {
            Pattern::Nothing => write!(f, "discard everything")?,
            Pattern::Made(k) => write!(f, "{}", made_word(k))?,
            Pattern::Pair { ranks: r } => write!(f, "pair{}", ranks(r))?,
            Pattern::TwoPair => write!(f, "two pair")?,
            Pattern::Trips {
                ranks: r,
                kicker: k,
            } => write!(f, "three of a kind{}{}", ranks(r), kicker(k))?,
            Pattern::Quads {
                ranks: r,
                kicker: k,
            } => write!(f, "four of a kind{}{}", ranks(r), kicker(k))?,
            Pattern::Draw { family, n, w, h } => {
                write!(f, "{n} to a {}", family.word())?;
                if let Some(w) = w {
                    write!(f, " w={w}")?;
                }
                if let Some(h) = h {
                    write!(f, " h={h}")?;
                }
            }
            Pattern::Pat(m) => {
                let words: Vec<&str> = (0..6)
                    .filter(|b| m >> b & 1 == 1)
                    .map(|b| PAT_WORDS[b])
                    .collect();
                write!(f, "{}", words.join(", "))?;
            }
            Pattern::High { n, suited } => {
                write!(f, "{n} high card{}", if n == 1 { "" } else { "s" })?;
                match suited {
                    Some(true) => write!(f, " suited")?,
                    Some(false) => write!(f, " unsuited")?,
                    None => {}
                }
            }
            Pattern::Exact { ranks, suited } => {
                write!(f, "{}", format_cards(ranks))?;
                match suited {
                    Some(true) => write!(f, " suited")?,
                    Some(false) => write!(f, " unsuited")?,
                    None => {}
                }
            }
        }
        for (name, q) in [("fp", self.fp), ("sp", self.sp)] {
            match q {
                Some(Cmp::Eq(n)) => write!(f, " {name}={n}")?,
                Some(Cmp::Ge(n)) => write!(f, " {name}>={n}")?,
                None => {}
            }
        }
        if self.prefer_low {
            write!(f, " prefer low")?;
        }
        Ok(())
    }
}

fn parse_cmp(s: &str, key: &str) -> Result<Option<Cmp>, String> {
    let Some(rest) = s.strip_prefix(key) else {
        return Ok(None);
    };
    let (ge, num) = if let Some(n) = rest.strip_prefix(">=") {
        (true, n)
    } else if let Some(n) = rest.strip_prefix('=') {
        (false, n)
    } else {
        return Ok(None);
    };
    let n: u8 = num.parse().map_err(|_| format!("bad number in '{s}'"))?;
    Ok(Some(if ge { Cmp::Ge(n) } else { Cmp::Eq(n) }))
}

impl std::str::FromStr for Rule {
    type Err = String;
    fn from_str(line: &str) -> Result<Rule, String> {
        let line = line.split('#').next().unwrap().trim().to_ascii_lowercase();
        let mut words: Vec<&str> = line.split_whitespace().collect();
        if words.is_empty() {
            return Err("empty rule".into());
        }
        // Trailing options.
        let (mut fp, mut sp, mut w, mut h, mut prefer_low) = (None, None, None, None, false);
        loop {
            let Some(&last) = words.last() else { break };
            if last == "low" && words.len() >= 2 && words[words.len() - 2] == "prefer" {
                prefer_low = true;
                words.truncate(words.len() - 2);
            } else if let Some(c) = parse_cmp(last, "fp")? {
                fp = Some(c);
                words.pop();
            } else if let Some(c) = parse_cmp(last, "sp")? {
                sp = Some(c);
                words.pop();
            } else if let Some(v) = last.strip_prefix("w=") {
                w = Some(v.parse().map_err(|_| format!("bad w in '{line}'"))?);
                words.pop();
            } else if let Some(v) = last.strip_prefix("h=") {
                h = Some(v.parse().map_err(|_| format!("bad h in '{line}'"))?);
                words.pop();
            } else {
                break;
            }
        }
        let text = words.join(" ");
        let ranks_kicker = |rest: &str| -> Result<(u16, Option<u16>), String> {
            let rest = rest.trim();
            let (r, k) = match rest.split_once("kicker") {
                Some((r, k)) => (r.trim(), Some(parse_ranks(k.trim())?)),
                None => (rest, None),
            };
            let r = if r.is_empty() {
                ALL_RANKS
            } else {
                parse_ranks(r)?
            };
            Ok((r, k))
        };
        let pattern = match text.as_str() {
            t if t.contains(',')
                && !t.starts_with("four of a kind ")
                && !t.starts_with("three of a kind ")
                && !t.starts_with("pair ") =>
            {
                let mut m = 0u8;
                for part in t.split(',') {
                    let b = PAT_WORDS
                        .iter()
                        .position(|w| *w == part.trim())
                        .ok_or_else(|| {
                            format!("'{}' is not a pat hand in '{line}'", part.trim())
                        })?;
                    m |= 1 << b;
                }
                if m.count_ones() < 2 {
                    return Err(format!("repeated pat hand in '{line}'"));
                }
                Pattern::Pat(m)
            }
            "discard everything" => Pattern::Nothing,
            "royal flush" => Pattern::Made(HandKind::RoyalFlush),
            "straight flush" => Pattern::Made(HandKind::StraightFlush),
            "full house" => Pattern::Made(HandKind::FullHouse),
            "flush" => Pattern::Made(HandKind::Flush),
            "straight" => Pattern::Made(HandKind::Straight),
            "two pair" => Pattern::TwoPair,
            t if t.starts_with("four of a kind") => {
                let (ranks, kicker) = ranks_kicker(&t["four of a kind".len()..])?;
                Pattern::Quads { ranks, kicker }
            }
            t if t.starts_with("three of a kind") => {
                let (ranks, kicker) = ranks_kicker(&t["three of a kind".len()..])?;
                Pattern::Trips { ranks, kicker }
            }
            t if t == "pair" || t.starts_with("pair ") => {
                let r = t[4..].trim();
                Pattern::Pair {
                    ranks: if r.is_empty() {
                        ALL_RANKS
                    } else {
                        parse_ranks(r)?
                    },
                }
            }
            t if t.len() > 2
                && t.as_bytes()[0].is_ascii_digit()
                && t[1..].starts_with(" high card") =>
            {
                let n = t[..1].parse::<u8>().unwrap();
                let rest = t[1..]
                    .trim_start_matches(" high cards")
                    .trim_start_matches(" high card")
                    .trim();
                let suited = match rest {
                    "" => None,
                    "suited" => Some(true),
                    "unsuited" => Some(false),
                    x => return Err(format!("unknown word '{x}' in '{line}'")),
                };
                if !(1..=4).contains(&n) || (n == 1 && suited.is_some()) {
                    return Err(format!("bad high-card rule '{line}'"));
                }
                Pattern::High { n, suited }
            }
            t if t.len() > 7
                && t.as_bytes()[0].is_ascii_digit()
                && t[1..].starts_with(" to a ") =>
            {
                let n = t[..1].parse::<u8>().unwrap();
                let family = match &t[7..] {
                    "royal" => Family::Royal,
                    "straight flush" => Family::StraightFlush,
                    "flush" => Family::Flush,
                    "straight" => Family::Straight,
                    other => return Err(format!("unknown draw '{other}'")),
                };
                if !(3..=4).contains(&n) {
                    return Err(format!("draws are 3 or 4 cards: '{line}'"));
                }
                Pattern::Draw {
                    family,
                    n,
                    w: w.take(),
                    h: h.take(),
                }
            }
            t => {
                let mut parts = t.split_whitespace();
                let cards = parts.next().unwrap();
                let suited = match parts.next() {
                    None => None,
                    Some("suited") => Some(true),
                    Some("unsuited") => Some(false),
                    Some(x) => return Err(format!("unknown word '{x}' in '{line}'")),
                };
                if parts.next().is_some() {
                    return Err(format!("cannot parse '{line}'"));
                }
                let ranks = parse_cards(&cards.to_ascii_uppercase())
                    .ok_or_else(|| format!("cannot parse '{line}'"))?;
                let n = ranks.count_ones();
                match (n, suited) {
                    (1, None) => {}
                    (1, Some(_)) => {
                        return Err(format!("a single card has no suitedness: '{line}'"));
                    }
                    (_, None) => return Err(format!("say suited or unsuited: '{line}'")),
                    _ => {}
                }
                Pattern::Exact { ranks, suited }
            }
        };
        if w.is_some() || h.is_some() {
            return Err(format!("w=/h= only apply to 'N to a ...' draws: '{line}'"));
        }
        Ok(Rule {
            pattern,
            fp,
            sp,
            prefer_low,
        })
    }
}

/// A ranked hold list. The last rule must be "discard everything".
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Strategy {
    pub rules: Vec<Rule>,
}

impl Strategy {
    pub fn parse(text: &str) -> Result<Strategy, String> {
        let mut rules = Vec::new();
        for (i, line) in text.lines().enumerate() {
            let body = line.split('#').next().unwrap().trim();
            if body.is_empty() {
                continue;
            }
            rules.push(
                body.parse::<Rule>()
                    .map_err(|e| format!("line {}: {e}", i + 1))?,
            );
        }
        if rules.last().map(|r| r.pattern) != Some(Pattern::Nothing) {
            return Err("the last rule must be 'discard everything'".into());
        }
        if rules[..rules.len() - 1]
            .iter()
            .any(|r| r.pattern == Pattern::Nothing)
        {
            return Err("'discard everything' may only be the last rule".into());
        }
        Ok(Strategy { rules })
    }

    pub fn to_text(&self) -> String {
        self.rules.iter().map(|r| format!("{r}\n")).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let text = "\
royal flush
4 to a royal
straight flush, four of a kind, full house
flush, straight
four of a kind 2-4 kicker A,2-4
four of a kind
three of a kind A kicker 2-4
two pair
pair J-A
pair A
3 to a straight flush w=2 h=1 fp=0
4 to a straight w=1 h=3 sp>=1
4 to a flush
QJ suited fp>=1
KQJ unsuited
2 high cards unsuited
1 high card prefer low
J prefer low
discard everything
";
        let s = Strategy::parse(text).unwrap();
        assert_eq!(s.to_text(), text);
        assert_eq!(s.rules.len(), 19);
    }

    #[test]
    fn rank_sets() {
        assert_eq!(format_ranks(parse_ranks("A,2-4").unwrap()), "A,2-4");
        assert_eq!(format_ranks(parse_ranks("J-A").unwrap()), "J-A");
        assert_eq!(format_ranks(parse_ranks("2-T").unwrap()), "2-T");
        assert_eq!(format_ranks(parse_ranks("A").unwrap()), "A");
        assert_eq!(parse_ranks("2-A").unwrap(), ALL_RANKS);
        assert!(parse_ranks("K-2").is_err());
    }

    #[test]
    fn rejects_bad_rules() {
        for bad in [
            "pair X",
            "5 to a straight",
            "QJ",
            "K suited",
            "AKQJT9 unsuited",
            "flush w=2",
            "3 to a donut",
            "flush, flush",
            "flush, pair",
            "royal flush\ndiscard everything\nflush",
        ] {
            assert!(
                Strategy::parse(&format!("{bad}\ndiscard everything")).is_err(),
                "{bad}"
            );
        }
        assert!(Strategy::parse("royal flush").is_err());
    }
}
