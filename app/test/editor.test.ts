// Milestone 7: strategy editor model, live evaluation, the player's own
// strategies, and the pay table comparison through the worker's handler.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import init, { Engine, catalog, parseRule } from "../src/wasm/ovp_engine.js";
import { EngineHost } from "../src/engine/core";
import type { Comparison, StrategyReport } from "../src/engine/protocol";
import { DISCARD, EditorModel } from "../src/editor/model";
import { Latest } from "../src/editor/live";
import { CustomStrategies, customStrategyText } from "../src/customStrategies";
import { loadLevel, loadPresetStrategy, presetRules, strategyHeader } from "../src/strategies";
import { defaultSides } from "../src/ui/compare";
import { loadPrefs, savePrefs } from "../src/ui/prefs";
import type { PayTableJson } from "../src/engine/protocol";

let host: EngineHost;

beforeAll(async () => {
  const bytes = readFileSync(new URL("../src/wasm/ovp_engine_bg.wasm", import.meta.url));
  await init({ module_or_path: bytes });
  host = new EngineHost({ catalog, builtin: (id) => Engine.builtin(id) });
});

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

function evaluate(text: string): StrategyReport {
  const r = host.handle({ kind: "evaluateStrategy", text, bet: 5 });
  if (r.kind !== "evaluateStrategy") throw new Error("wrong reply");
  return r.report;
}

describe("rule parser (wasm)", () => {
  it("returns canonical notation and rejects nonsense", () => {
    expect(parseRule("pair  J-A")).toBe("pair J-A");
    expect(parseRule("4 to a straight w=2  # comment")).toBe("4 to a straight w=2");
    expect(() => parseRule("five aces")).toThrow();
    expect(() => parseRule("  ")).toThrow();
  });
});

describe("editor model", () => {
  const model = () => {
    const m = new EditorModel(parseRule);
    m.load("# header\nroyal flush\npair J-A   # fires\n4 to a flush\ndiscard everything\n");
    return m;
  };

  it("loads rules, keeps 'discard everything' last and fixed", () => {
    const m = model();
    expect(m.rules()).toEqual(["royal flush", "pair J-A", "4 to a flush", DISCARD]);
    expect(m.valid()).toBe(true);
    expect(m.dirty).toBe(false);
    expect(m.isFixed(3)).toBe(true);
    m.move(0, 99); // clamped above the final line
    expect(m.rules()).toEqual(["pair J-A", "4 to a flush", "royal flush", DISCARD]);
    m.remove(3); // the final line can't be removed
    m.edit(3, "pair");
    expect(m.rules().at(-1)).toBe(DISCARD);
    expect(m.rules()).toHaveLength(4);
    // A file without the final line gets it; one in the middle is dropped.
    m.load("pair\ndiscard everything\nflush");
    expect(m.rules()).toEqual(["pair", "flush", DISCARD]);
  });

  it("edits, inserts, removes, moves and undoes", () => {
    const m = model();
    m.edit(1, "pair   J-A"); // same rule once canonical: no change
    expect(m.canUndo).toBe(false);
    m.edit(1, "pair");
    const at = m.insert(99, "3 to a royal");
    expect(at).toBe(3);
    m.move(3, 0);
    m.remove(1);
    expect(m.rules()).toEqual(["3 to a royal", "pair", "4 to a flush", DISCARD]);
    expect(m.dirty).toBe(true);
    m.undo();
    m.undo();
    m.undo();
    m.undo();
    expect(m.rules()).toEqual(["royal flush", "pair J-A", "4 to a flush", DISCARD]);
    expect(m.canUndo).toBe(false);
    expect(m.dirty).toBe(false);
    m.replaceAll("flush\nstraight\n");
    expect(m.rules()).toEqual(["flush", "straight", DISCARD]);
    m.undo();
    expect(m.rules()).toEqual(["royal flush", "pair J-A", "4 to a flush", DISCARD]);
  });

  it("flags bad lines, blank new lines and repeats", () => {
    const m = model();
    m.insert(0);
    expect(m.lines[0].error).toBe("type a rule");
    expect(m.valid()).toBe(false);
    m.edit(0, "pairs of jacks");
    expect(m.lines[0].error).toBeTruthy();
    expect(m.firstError()?.line).toBe(0);
    m.edit(0, "discard everything");
    expect(m.lines[0].error).toMatch(/last line/);
    m.edit(0, "4 to a flush");
    expect(m.valid()).toBe(true);
    expect(m.lines[3].repeats).toBe(0);
    // A repeat is valid and never fires: evaluating shows it with 0 fires.
    host.handle({ kind: "load", paytableId: "jacks-or-better-9-6" });
    const r = evaluate(m.text());
    expect(r.rules[3].fires).toBe(0);
  });
});

describe("live evaluation", () => {
  it("runs the latest request only and reports only its result", async () => {
    const runs: string[] = [];
    const done: string[] = [];
    const gates: (() => void)[] = [];
    const live = new Latest<string>(
      (k) =>
        new Promise((res) => {
          runs.push(k);
          gates.push(() => res(k.toUpperCase()));
        }),
      (_, r) => done.push(r),
      () => {},
    );
    live.request("a");
    live.request("b");
    live.request("c"); // b is overtaken before it starts
    expect(runs).toEqual(["a"]);
    gates.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toEqual([]); // a was overtaken by c
    expect(runs).toEqual(["a", "c"]);
    gates.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toEqual(["C"]);
    expect(live.running).toBe(false);
  });
});

describe("the player's own strategy", () => {
  it("saves file text whose header matches a fresh exact evaluation", async () => {
    host.handle({ kind: "load", paytableId: "jacks-or-better-9-6" });
    const m = new EditorModel(parseRule);
    m.load(await loadPresetStrategy("jacks-or-better-9-6", "beginner"));
    m.move(m.rules().indexOf("4 to a flush"), 0); // a (bad) edit
    const report = evaluate(m.text());
    const text = customStrategyText(m.rules(), { game: "jacks-or-better", paytable: "jacks-or-better-9-6", bet: 5, progressive: null }, report);
    const store = new CustomStrategies(memStore());
    expect(store.has("jacks-or-better-9-6")).toBe(false);
    store.save("jacks-or-better-9-6", text);
    expect(await loadLevel(store, "jacks-or-better-9-6", "custom")).toBe(text);
    expect(await loadLevel(store, "jacks-or-better-8-5", "custom")).toBe("");
    // The saved file parses back and its recorded numbers are exact.
    const again = evaluate(text);
    expect(again.rules.map((r) => r.text)).toEqual(m.rules());
    expect(strategyHeader(text, "return")).toBe(`${(again.return * 100).toFixed(6)}%  optimal: ${(again.optimal * 100).toFixed(6)}%`);
    expect(strategyHeader(text, "loss")?.split(" ")[0]).toBe(again.lossCredits.toFixed(6));
    expect(strategyHeader(text, "tier")).toBe("custom");
    // Worse than the preset: the edit put 4 to a flush above the pat hands.
    const preset = evaluate(await loadPresetStrategy("jacks-or-better-9-6", "beginner"));
    expect(again.return).toBeLessThan(preset.return);
    expect(again.worst.length).toBeGreaterThan(0);
    expect(again.worst[0].loss).toBeGreaterThan(0);
    store.remove("jacks-or-better-9-6");
    expect(store.has("jacks-or-better-9-6")).toBe(false);
  });

  it("ignores malformed storage", () => {
    const s = memStore();
    s.setItem("ovp.customStrategies.v1", '{"a": {"text": 5}, "b": {"text": "x", "saved": 1}}');
    const c = new CustomStrategies(s);
    expect(c.has("a")).toBe(false);
    expect(c.get("b")?.text).toBe("x");
    s.setItem("ovp.customStrategies.v1", "not json");
    expect(c.has("b")).toBe(false);
  });

  it("is a trainer level that persists in prefs", () => {
    const s = memStore();
    const p = loadPrefs(s);
    p.tier = "custom";
    savePrefs(s, p);
    expect(loadPrefs(s).tier).toBe("custom");
  });

  it("suggests every preset rule of the game", async () => {
    const list = await presetRules(["jacks-or-better-9-6", "jacks-or-better-8-5"]);
    expect(list).toContain("pair J-A");
    expect(list).toContain(DISCARD);
    expect(new Set(list).size).toBe(list.length);
    for (const r of list) expect(parseRule(r)).toBe(r);
  });
});

describe("pay table comparison", () => {
  function compare(a: string, b: string): Comparison {
    const r = host.handle({ kind: "compareStrategies", a, b, bet: 5 });
    if (r.kind !== "compareStrategies") throw new Error("wrong reply");
    return r.comparison;
  }

  it("JoB 9/6 vs 8/5: endpoints are exact evaluations and effects add up", async () => {
    host.handle({ kind: "load", paytableId: "jacks-or-better-8-5" });
    const a = await loadPresetStrategy("jacks-or-better-9-6", "beginner");
    const b = await loadPresetStrategy("jacks-or-better-8-5", "beginner");
    const c = compare(a, b);
    expect(c.aOnB).toBe(evaluate(a).return);
    expect(c.bOnB).toBe(evaluate(b).return);
    expect(c.optimalB).toBeCloseTo(0.972984, 5);
    expect(c.changes.length).toBeGreaterThan(0);
    const sum = c.changes.reduce((s, ch) => s + ch.delta, 0);
    expect(sum).toBeCloseTo(c.bOnB - c.aOnB, 12);
    const eff = c.differences.reduce((s, d) => s + d.effect, 0);
    expect(eff).toBeCloseTo((c.bOnB - c.aOnB) * 5, 11);
    for (const ch of c.changes) {
      if (ch.from !== null) expect(c.a[ch.from]).toBe(ch.rule);
      if (ch.to !== null) expect(c.b[ch.to]).toBe(ch.rule);
    }
    expect(c.a.at(-1)).toBe(DISCARD);
    expect(c.b.at(-1)).toBe(DISCARD);
  });

  it("a strategy against itself has no changes", async () => {
    host.handle({ kind: "load", paytableId: "double-bonus-10-7" });
    const a = await loadPresetStrategy("double-bonus-10-7", "intermediate");
    const c = compare(a, a);
    expect(c.changes).toEqual([]);
    expect(c.differences).toEqual([]);
    expect(c.aOnB).toBe(c.bOnB);
  });

  it("defaults to the game's full-pay preset as A and the current table as B", () => {
    const tables = JSON.parse(catalog()).paytables as PayTableJson[];
    expect(defaultSides(tables, "jacks-or-better-8-5", "expert").map((s) => s.table)).toEqual(["jacks-or-better-9-6", "jacks-or-better-8-5"]);
    // On the full-pay table itself, B is the next preset.
    expect(defaultSides(tables, "jacks-or-better-9-6", "beginner").map((s) => s.table)).toEqual(["jacks-or-better-9-6", "jacks-or-better-9-5"]);
    const custom = { id: "custom:double-bonus:x", game: "double-bonus", name: "X", pays: {} };
    expect(defaultSides([...tables, custom], custom.id, "custom").map((s) => s.table)).toEqual(["double-bonus-10-7", custom.id]);
  });
});
