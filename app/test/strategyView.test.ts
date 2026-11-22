// Strategy view: rule rows, scrolling, tier tabs, clicks, and the new
// "strategy" button in the input layer.
import { describe, expect, it } from "vitest";
import { loadPresetStrategy } from "../src/strategies";
import { CLOSE_RECT, VISIBLE_ROWS, maxScroll, strategyRows, strategyTagRect, tabRect } from "../src/render/strategyView";
import { rulesOf, StrategyScreen } from "../src/ui/strategyScreen";
import { DEFAULT_KEYMAP } from "../src/config/keymap";
import { keymapConflicts } from "../src/input/keyboard";
import { isGameButton } from "../src/input/actions";
import { loadPrefs } from "../src/ui/prefs";
import { LAYOUT, SCREEN } from "../src/config/feel";
import type { Tier } from "../src/engine/protocol";

(globalThis as unknown as { window: unknown }).window = { addEventListener() {}, removeEventListener() {} };

function screen(texts: Record<Tier, string>) {
  let tier: Tier = "intermediate";
  let redraws = 0;
  const s = new StrategyScreen({
    loadText: async (t) => texts[t],
    tier: () => tier,
    setTier: (t) => (tier = t),
    title: () => "STRATEGY - TEST",
    summary: () => "SUMMARY",
    closeKey: () => "S",
    redraw: () => redraws++,
  });
  return { s, tier: () => tier, redraws: () => redraws };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("strategy view", () => {
  it("numbers every rule once, in plain words, wrapping long ones", async () => {
    const text = await loadPresetStrategy("jacks-or-better-9-6", "expert");
    const rules = rulesOf(text);
    const rows = strategyRows(rules);
    expect(rows.filter(([n]) => n).map(([n]) => n)).toEqual(rules.map((_, i) => `${i + 1}.`));
    expect(rows.some(([, t]) => /W=|H=|FP|SP|PREFER/.test(t))).toBe(false);
    expect(rows.find(([n]) => n === `${rules.length}.`)![1]).toBe("DISCARD EVERYTHING");
    expect(maxScroll(rules)).toBe(Math.max(0, rows.length - VISIBLE_ROWS));
    expect(maxScroll(null)).toBe(0);
  });

  it("opens, loads the tier, scrolls within bounds, switches tier by tab, closes", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `pair ${i}`).join("\n");
    const { s, tier } = screen({ beginner: "pair\ndiscard everything", intermediate: long, expert: "" });
    s.show();
    expect(s.content().rules).toBeNull(); // loading
    await tick();
    expect(s.content().rules).toHaveLength(60);
    s.scrollBy(-5);
    expect(s.scroll).toBe(0);
    s.scrollBy(1e6);
    expect(s.scroll).toBe(60 - VISIBLE_ROWS);
    // Click the Beginner tab.
    const b = tabRect(0);
    expect(s.click(b.x + 2, b.y + 2)).toBe(true);
    expect(tier()).toBe("beginner");
    expect(s.scroll).toBe(0);
    await tick();
    expect(s.content().rules).toEqual(["pair", "discard everything"]);
    // Expert has no preset here: shown as empty, not loading.
    s.selectTier("expert");
    await tick();
    expect(s.content().rules).toEqual([]);
    // Clicks elsewhere in the view are swallowed; Close closes.
    expect(s.click(200, 150)).toBe(true);
    expect(s.open).toBe(true);
    expect(s.click(CLOSE_RECT.x + 1, CLOSE_RECT.y + 1)).toBe(true);
    expect(s.open).toBe(false);
    expect(s.click(200, 150)).toBe(false);
  });

  it("lays out inside the screen", () => {
    for (let i = 0; i < 3; i++) {
      const r = tabRect(i);
      expect(r.x).toBeGreaterThan(0);
      expect(r.x + r.w).toBeLessThan(SCREEN.w);
    }
    const tag = strategyTagRect("INTERMEDIATE STRATEGY (S)");
    expect(tag.y + tag.h).toBeLessThanOrEqual(SCREEN.h);
    // The tag stays clear of the centered game label for every preset.
    expect(tag.x + tag.w).toBeLessThan(SCREEN.w / 2 - (("DOUBLE DOUBLE BONUS 9/6".length * 6) / 2));
    expect(LAYOUT.strategyTag.y).toBeGreaterThan(LAYOUT.meters.valueY + 14);
  });
});

describe("strategy button", () => {
  it("defaults to S, has no conflicts, and is not a game button", () => {
    expect(DEFAULT_KEYMAP.strategy).toEqual(["KeyS"]);
    expect(keymapConflicts(DEFAULT_KEYMAP)).toEqual([]);
    expect(isGameButton("strategy")).toBe(false);
    expect(isGameButton("dealDraw")).toBe(true);
  });

  it("keeps a player's remapped keys from before the button existed", () => {
    const old = { ...DEFAULT_KEYMAP, dealDraw: ["Space"] } as Record<string, string[]>;
    delete old.strategy;
    const store = { getItem: () => JSON.stringify({ keymap: old }), setItem() {} };
    const p = loadPrefs(store);
    expect(p.keymap.dealDraw).toEqual(["Space"]);
    expect(p.keymap.strategy).toEqual(["KeyS"]);
  });
});
