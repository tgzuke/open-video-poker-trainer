// Player-facing wording for strategy rules. Display only: strategy files
// keep the exact notation (docs/strategy-format.md), and this translates
// the engine's canonical rule text when it is shown in the game.
//
//   4 to a straight w=2              → 4 to an outside straight
//   3 to a straight flush w=2 h=1    → 3 to a straight flush, 2 ways, 1 high card
//   2 high cards suited fp=0         → 2 high cards suited, no flush penalty
//   pair J-A                         → pair, J or better

/** Pat hands, as the engine names them on a combined line. */
const PAT_WORDS = ["royal flush", "straight flush", "four of a kind", "full house", "flush", "straight"];

const RANK_PLURAL: Record<string, string> = {
  A: "aces", K: "kings", Q: "queens", J: "jacks", T: "10s",
  9: "9s", 8: "8s", 7: "7s", 6: "6s", 5: "5s", 4: "4s", 3: "3s", 2: "2s",
};

const rankName = (r: string) => (r === "T" ? "10" : r);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Rank set as written ("A,2-4" → "A, 2-4"). For pairs, open-ended
 *  ranges read as players say them: "J-A" → "J or better", "2-T" →
 *  "10 or lower". */
export function rankSet(s: string, pair = false): string {
  const m = /^([2-9TJQKA])-([2-9TJQKA])$/.exec(s);
  if (pair && m && m[2] === "A" && m[1] !== "2") return `${rankName(m[1])} or better`;
  if (pair && m && m[1] === "2" && m[2] !== "A") return `${rankName(m[2])} or lower`;
  return s
    .split(",")
    .map((part) => part.split("-").map(rankName).join("-"))
    .join(", ");
}

function penalty(kind: string, op: string, n: number): string {
  if (op === "=" && n === 0) return `no ${kind} penalty`;
  if (op === ">=" && n === 1) return `${kind} penalty`;
  if (op === ">=") return `${n}+ ${kind} penalty`;
  return plural(n, `${kind} penalty card`);
}

/** The rules written on one strategy line. Several rules may share a line
 *  ("three of a kind, two pair"); adjacent pat hands stay together as one
 *  combined rule, as the engine reads them. */
export function lineRules(line: string): string[] {
  const out: string[] = [];
  let pat = false;
  for (const part of line.trim().split(", ")) {
    const isPat = PAT_WORDS.includes(part);
    if (isPat && pat) out[out.length - 1] += `, ${part}`;
    else out.push(part);
    pat = isPat;
  }
  return out;
}

/** Player-facing wording of a strategy line: each rule on it, joined by
 *  " / " when several share the line. */
export function ruleDisplay(text: string): string {
  const parts = lineRules(text);
  return parts.length > 1 ? parts.map(singleRuleDisplay).join(" / ") : singleRuleDisplay(text);
}

function singleRuleDisplay(text: string): string {
  // Canonical form: PATTERN [w=N] [h=N] [fp..] [sp..] [prefer low]
  const m = /^(.*?)(?: w=(\d+))?(?: h=(\d+))?(?: fp(=|>=)(\d+))?(?: sp(=|>=)(\d+))?( prefer low)?$/.exec(text.trim());
  if (!m) return text;
  const [, pattern, w, h, fpOp, fpN, spOp, spN, low] = m;
  let base = pattern;
  const quals: string[] = [];

  const draw = /^(\d) to a (royal|straight flush|flush|straight)$/.exec(pattern);
  if (w !== undefined) {
    const ways = Number(w);
    if (draw && draw[1] === "4" && (ways === 1 || ways === 2))
      base = `4 to an ${ways === 2 ? "outside" : "inside"} ${draw[2]}`;
    else quals.push(plural(ways, "way"));
  }
  if (h !== undefined) quals.push(h === "0" ? "no high cards" : plural(Number(h), "high card"));
  if (fpOp) quals.push(penalty("flush", fpOp, Number(fpN)));
  if (spOp) quals.push(penalty("straight", spOp, Number(spN)));
  if (low) quals.push("keep the lowest");

  const made = /^(pair|three of a kind|four of a kind)(?: ([^ ]+))?(?: kicker ([^ ]+))?$/.exec(pattern);
  if (made && (made[2] || made[3])) {
    const [, kind, ranks, kicker] = made;
    // One rank reads as a player says it: "pair of aces", "four 5s".
    const single = ranks && /^[2-9TJQKA]$/.test(ranks) ? RANK_PLURAL[ranks] : null;
    const head = single
      ? `${kind === "pair" ? "pair of" : kind === "three of a kind" ? "three" : "four"} ${single}`
      : [kind, ranks && rankSet(ranks, kind === "pair")].filter(Boolean).join(", ");
    base = kicker ? `${head}, kicker ${rankSet(kicker)}` : head;
  }

  // Lists of pat hands: all six read "any pat hand"; shorter lists say quads.
  const pats = pattern.split(", ");
  if (pats.length > 1 && pats.every((p) => PAT_WORDS.includes(p)))
    base = pats.length === PAT_WORDS.length ? "any pat hand" : pats.map((p) => (p === "four of a kind" ? "quads" : p)).join(", ");

  // Exact ranks ("KQJT suited"): spell 10.
  if (/^[2-9TJQKA]+( suited| unsuited)?$/.test(pattern)) base = pattern.replace(/T/g, "10");

  return [base, ...quals].join(", ");
}
