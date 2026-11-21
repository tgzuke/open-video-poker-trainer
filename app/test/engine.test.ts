// Runs the real WebAssembly engine under Node through the same request
// handler the worker uses.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import init, { Engine } from "../src/wasm/ovp_engine.js";
import { EngineHost, bestHold } from "../src/engine/core";

let host: EngineHost;

beforeAll(async () => {
  const bytes = readFileSync(new URL("../src/wasm/ovp_engine_bg.wasm", import.meta.url));
  await init({ module_or_path: bytes });
  host = new EngineHost((id) => Engine.builtin(id));
  host.handle({ kind: "load", paytableId: "jacks-or-better-9-6" });
});

describe("wasm engine", () => {
  it("pays a dealt royal 4000 at max bet and holds all five", () => {
    const r = host.handle({ kind: "holdEvs", hand: "As Ks Qs Js Ts", bet: 5 });
    if (r.kind !== "holdEvs") throw new Error("wrong reply");
    expect(r.result.best).toBe(31);
    expect(r.result.evs[31]).toBe(4000);
    expect(r.result.cards).toEqual(["As", "Ks", "Qs", "Js", "Ts"]);
  });

  it("returns the same 9/6 optimal return as the native CLI", () => {
    const r = host.handle({ kind: "optimalReturn", bet: 5 });
    if (r.kind !== "optimalReturn") throw new Error("wrong reply");
    // Native exact value: 1653526326983 / 1661102543100
    expect(r.ret).toBeCloseTo(1653526326983 / 1661102543100, 12);
  });

  it("computes 32 hold EVs well under 10 ms", () => {
    const hands = ["Js Ts 9s 2h 2d", "Ah Kd 7c 4s 2h", "5c 6c 7c 8c Kd", "Qh Qd 3s 3c 9h"];
    const t0 = performance.now();
    const n = 2000;
    for (let i = 0; i < n; i++) host.handle({ kind: "holdEvs", hand: hands[i % 4], bet: 5 });
    const perHand = (performance.now() - t0) / n;
    expect(perHand).toBeLessThan(1);
  });

  it("rejects bad hands", () => {
    expect(() => host.handle({ kind: "holdEvs", hand: "As As Qs Js Ts", bet: 5 })).toThrow(/duplicate/);
    expect(() => host.handle({ kind: "holdEvs", hand: "As Ks", bet: 5 })).toThrow();
    expect(() => host.handle({ kind: "holdEvs", hand: "As Ks Qs Js Ts", bet: 6 })).toThrow(/bet/);
  });

  it("bestHold picks the maximum", () => {
    expect(bestHold([1, 3, 2])).toBe(1);
  });
});
