// Player-facing rule wording (display only; files keep the notation).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rankSet, ruleDisplay } from "../src/trainer/ruleText";
import { FEEDBACK_CHARS, FEEDBACK_RULE_LINES, wrap } from "../src/render/cabinet";
import { LESSON_TEXT } from "../src/config/trainer";
import { strategyRuleOrder } from "../src/ui/statsView";

const dir = new URL("../../strategies/", import.meta.url);
const shipped = [
  ...new Set(
    readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).flatMap((t) =>
      readdirSync(new URL(`${t}/`, dir)).filter((f) => f.endsWith(".txt")).flatMap((f) => strategyRuleOrder(readFileSync(new URL(`${t}/${f}`, dir), "utf8"))),
    ),
  ),
];

describe("rule wording", () => {
  it("translates the notation", () => {
    const cases: [string, string][] = [
      ["4 to a straight w=2", "4 to an outside straight"],
      ["4 to a straight w=1", "4 to an inside straight"],
      ["4 to a straight flush w=1 h=1", "4 to an inside straight flush, 1 high card"],
      ["3 to a straight flush w=2 h=1 sp>=1", "3 to a straight flush, 2 ways, 1 high card, straight penalty"],
      ["3 to a royal w=3 h=2 fp=0", "3 to a royal, 3 ways, 2 high cards, no flush penalty"],
      ["3 to a flush h=0", "3 to a flush, no high cards"],
      ["1 high card fp>=2 prefer low", "1 high card, 2+ flush penalty, keep the lowest"],
      ["2 high cards suited sp=0 prefer low", "2 high cards suited, no straight penalty, keep the lowest"],
      ["pair J-A", "pair, J or better"],
      ["pair 2-T", "pair, 10 or lower"],
      ["three of a kind A", "three of a kind, A"],
      ["four of a kind A kicker 2-4", "four of a kind, A, kicker 2-4"],
      ["four of a kind 2-4 kicker A,2-4", "four of a kind, 2-4, kicker A, 2-4"],
      ["three of a kind 2-T", "three of a kind, 2-10"],
      ["four of a kind kicker A", "four of a kind, kicker A"],
      ["KQJT suited", "KQJ10 suited"],
      ["QJ unsuited", "QJ unsuited"],
      ["pair", "pair"],
      ["royal flush, straight flush, four of a kind, full house", "royal flush, straight flush, quads, full house"],
      ["royal flush, straight flush, four of a kind, full house, flush, straight", "any pat hand"],
      ["four of a kind", "four of a kind"],
      ["discard everything", "discard everything"],
    ];
    for (const [file, shown] of cases) expect(ruleDisplay(file), file).toBe(shown);
    expect(rankSet("5-K")).toBe("5-K");
    expect(rankSet("J-A")).toBe("J-A");
    expect(rankSet("J-A", true)).toBe("J or better");
  });

  it("leaves no notation codes in any shipped rule, and every rule fits on screen", () => {
    expect(shipped.length).toBeGreaterThan(100);
    for (const r of shipped) {
      const shown = ruleDisplay(r);
      expect(shown, r).not.toMatch(/\b(w|h)=|fp|sp|>=|prefer low|\bT\b/);
      expect(wrap(shown.toUpperCase(), FEEDBACK_CHARS).length, shown).toBeLessThanOrEqual(FEEDBACK_RULE_LINES);
      expect(LESSON_TEXT.rule(shown.toUpperCase()).length, shown).toBeLessThanOrEqual(80);
    }
  });
});
