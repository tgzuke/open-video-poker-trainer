// Runs the real WebAssembly engine under Node through the same request
// handler the worker uses.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import init, { Engine, catalog } from "../src/wasm/ovp_engine.js";
import { EngineHost, bestHold } from "../src/engine/core";
import type { ResponseData } from "../src/engine/protocol";

let host: EngineHost;

function ret(r: ResponseData): number {
  if (r.kind !== "optimalReturn") throw new Error("wrong reply");
  return r.ret;
}
function holds(r: ResponseData) {
  if (r.kind !== "holdEvs") throw new Error("wrong reply");
  return r.result;
}

beforeAll(async () => {
  const bytes = readFileSync(new URL("../src/wasm/ovp_engine_bg.wasm", import.meta.url));
  await init({ module_or_path: bytes });
  host = new EngineHost({ catalog, builtin: (id) => Engine.builtin(id) });
  host.handle({ kind: "load", paytableId: "jacks-or-better-9-6" });
});

describe("wasm engine", () => {
  it("pays a dealt royal 4000 at max bet and holds all five", () => {
    const r = holds(host.handle({ kind: "holdEvs", hand: "As Ks Qs Js Ts", bet: 5 }));
    expect(r.best).toBe(31);
    expect(r.evs[31]).toBe(4000);
    expect(r.cards).toEqual(["As", "Ks", "Qs", "Js", "Ts"]);
  });

  it("returns the same 9/6 optimal return as the native CLI", () => {
    // Native exact value: 1653526326983 / 1661102543100
    expect(ret(host.handle({ kind: "optimalReturn", bet: 5 }))).toBeCloseTo(1653526326983 / 1661102543100, 12);
  });

  it("computes 32 hold EVs well under 10 ms", () => {
    const hands = ["Js Ts 9s 2h 2d", "Ah Kd 7c 4s 2h", "5c 6c 7c 8c Kd", "Qh Qd 3s 3c 9h"];
    const t0 = performance.now();
    const n = 2000;
    for (let i = 0; i < n; i++) host.handle({ kind: "holdEvs", hand: hands[i % 4], bet: 5 });
    expect((performance.now() - t0) / n).toBeLessThan(1);
  });

  it("rejects bad input", () => {
    expect(() => host.handle({ kind: "holdEvs", hand: "As As Qs Js Ts", bet: 5 })).toThrow(/duplicate/);
    expect(() => host.handle({ kind: "holdEvs", hand: "As Ks", bet: 5 })).toThrow();
    expect(() => host.handle({ kind: "holdEvs", hand: "As Ks Qs Js Ts", bet: 6 })).toThrow(/bet/);
    expect(() => host.handle({ kind: "holdEvs", hand: "As Ks Qs Js Ts", bet: 5, progressive: 1.5 })).toThrow(/whole/);
    expect(() => host.handle({ kind: "load", paytableId: "nope" })).toThrow(/unknown/);
  });

  it("bestHold picks the maximum", () => {
    expect(bestHold([1, 3, 2])).toBe(1);
  });
});

describe("presets, bet and progressive through the worker host", () => {
  it("lists all four games and every preset loads", () => {
    const c = host.catalog();
    expect(c.games.map((g) => g.id).sort()).toEqual(["bonus-poker", "double-bonus", "double-double-bonus", "jacks-or-better"]);
    expect(c.paytables.length).toBeGreaterThanOrEqual(18);
    for (const g of c.games) expect(c.games.find((x) => x.id === g.id)!.label).not.toBe("");
  });

  it("switches tables within a game without rebuilding", () => {
    const a = host.handle({ kind: "load", paytableId: "double-bonus-10-7" });
    const b = host.handle({ kind: "load", paytableId: "double-bonus-9-6" });
    if (a.kind !== "load" || b.kind !== "load") throw new Error();
    expect(b.rebuilt).toBe(false);
    expect(ret(host.handle({ kind: "optimalReturn", bet: 5 }))).toBeCloseTo(0.97806227, 7);
  });

  it("bet below max scales; progressive raises the return at max bet only", () => {
    host.handle({ kind: "load", paytableId: "jacks-or-better-9-6" });
    const r1 = ret(host.handle({ kind: "optimalReturn", bet: 1 }));
    const r4 = ret(host.handle({ kind: "optimalReturn", bet: 4 }));
    const r5 = ret(host.handle({ kind: "optimalReturn", bet: 5 }));
    expect(r4).toBeCloseTo(r1, 12);
    expect(r5).toBeGreaterThan(r1);
    expect(ret(host.handle({ kind: "optimalReturn", bet: 5, progressive: 4000 }))).toBeCloseTo(r5, 12);
    expect(ret(host.handle({ kind: "optimalReturn", bet: 5, progressive: 8000 }))).toBeGreaterThan(r5);
    expect(ret(host.handle({ kind: "optimalReturn", bet: 4, progressive: 8000 }))).toBeCloseTo(r4, 12);
  });

  it("loads a custom table and validates it", () => {
    const base = host.catalog().paytables.find((t) => t.id === "jacks-or-better-9-6")!;
    host.handle({ kind: "loadCustom", paytable: { ...base, id: "custom:x", pays: { ...base.pays, full_house: 8 } } });
    expect(ret(host.handle({ kind: "optimalReturn", bet: 5 }))).toBeCloseTo(0.98392685, 7);
    expect(() =>
      host.handle({ kind: "loadCustom", paytable: { ...base, id: "custom:y", pays: { ...base.pays, nope: 1 } } }),
    ).toThrow(/unknown line/);
  });
});
