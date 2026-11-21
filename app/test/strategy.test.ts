// Strategy layer through the real WebAssembly engine and the worker host.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import init, { Engine, catalog } from "../src/wasm/ovp_engine.js";
import { EngineHost } from "../src/engine/core";
import type { ResponseData } from "../src/engine/protocol";
import { hasPresetStrategy, loadPresetStrategy, strategyHeader } from "../src/strategies";

let host: EngineHost;

function as<K extends ResponseData["kind"]>(r: ResponseData, k: K): Extract<ResponseData, { kind: K }> {
  if (r.kind !== k) throw new Error(`expected ${k}, got ${r.kind}`);
  return r as Extract<ResponseData, { kind: K }>;
}

beforeAll(async () => {
  await init({ module_or_path: readFileSync(new URL("../src/wasm/ovp_engine_bg.wasm", import.meta.url)) });
  host = new EngineHost({ catalog, builtin: (id) => Engine.builtin(id) });
  host.handle({ kind: "load", paytableId: "jacks-or-better-9-6" });
});

describe("preset strategies", () => {
  it("ship for every preset table and tier", () => {
    for (const t of host.catalog().paytables)
      for (const tier of ["beginner", "intermediate", "expert"] as const) expect(hasPresetStrategy(t.id, tier)).toBe(true);
  });

  it("evaluate in wasm to exactly their recorded return, complete", async () => {
    for (const tier of ["beginner", "expert"] as const) {
      const text = await loadPresetStrategy("jacks-or-better-9-6", tier);
      const { report } = as(host.handle({ kind: "evaluateStrategy", text, bet: 5 }), "evaluateStrategy");
      expect(report.complete).toBe(true);
      expect(`${(report.return * 100).toFixed(6)}%`).toBe(strategyHeader(text, "return")!.split(" ")[0]);
      expect(report.rules.reduce((a, r) => a + r.fires, 0)).toBeCloseTo(1, 12);
      expect(report.optimal).toBeCloseTo(1653526326983 / 1661102543100, 12);
    }
  });
});

describe("playing a strategy", () => {
  it("names the deciding rule and every matching rule", async () => {
    const text = await loadPresetStrategy("jacks-or-better-9-6", "beginner");
    const { play } = as(host.handle({ kind: "playStrategy", text, hand: "Ah Kh Qh Jh 2c" }), "playStrategy");
    expect(play.hold).toBe(0b01111);
    expect(play.cards).toEqual(["Ah", "Kh", "Qh", "Jh", "2c"]);
    const rules = text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(rules[play.rule!]).toMatch(/^4 to a royal/);
    expect(play.matching[0].rule).toBe(play.rule);
    expect(rules[play.matching.at(-1)!.rule]).toMatch(/^discard everything/);
  });

  it("rejects malformed strategies with a line number", () => {
    expect(() => host.handle({ kind: "evaluateStrategy", text: "royal flush\n3 to a donut\ndiscard everything", bet: 5 })).toThrow(
      /line 2/,
    );
    expect(() => host.handle({ kind: "evaluateStrategy", text: "royal flush", bet: 5 })).toThrow(/discard everything/);
  });
});

describe("generator in wasm", () => {
  it("generates complete, monotone tiers for a custom (small-deck) game", () => {
    const game = JSON.parse(catalog()).games.find((g: { id: string }) => g.id === "double-double-bonus");
    const table = JSON.parse(catalog()).paytables.find((t: { id: string }) => t.id === "double-double-bonus-9-6");
    game.deck.ranks = ["2", "3", "4", "5", "A"]; // 20 cards: fast, but every kicker line reachable
    const small = new EngineHost({ catalog: () => JSON.stringify({ games: [game], paytables: [table] }), builtin: () => Engine.fromJson(JSON.stringify(game), JSON.stringify(table)) });
    small.handle({ kind: "load", paytableId: table.id });
    let seed = "";
    let prev = Infinity;
    for (const tier of ["beginner", "intermediate", "expert"] as const) {
      seed = as(small.handle({ kind: "generateStrategy", tier, bet: 5, seed }), "generateStrategy").text;
      const { report } = as(small.handle({ kind: "evaluateStrategy", text: seed, bet: 5 }), "evaluateStrategy");
      expect(report.complete).toBe(true);
      expect(report.lossCredits).toBeLessThanOrEqual(prev + 1e-12);
      prev = report.lossCredits;
    }
  });
});
