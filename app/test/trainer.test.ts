// Milestone 5: grading, rule distance colors, Lesson/Practice/Free Play
// flow, stats and their persistence.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import init, { Engine, Rules as WasmRules, catalog } from "../src/wasm/ovp_engine.js";
import { EngineHost } from "../src/engine/core";
import type { DealCheck } from "../src/engine/protocol";
import { loadPresetStrategy } from "../src/strategies";
import { gradeHold, graceAt, heldMask, samePlay } from "../src/trainer/grade";
import { Trainer, type CheckResult, type TrainerSettings } from "../src/trainer/trainer";
import { emptyAgg, record, reviveAgg, type HandRecord } from "../src/trainer/stats";
import { MemoryKv, Stats } from "../src/trainer/store";
import { GameApp } from "../src/game/app";
import { Pix } from "../src/render/pix";
import { Sfx } from "../src/audio/sfx";
import { wrap } from "../src/render/cabinet";
import { strategyRuleOrder } from "../src/ui/statsView";
import { loadPrefs, savePrefs } from "../src/ui/prefs";

let host: EngineHost;
let parser: Engine;
let beginner: string;

function check(hand: string, bet = 5): { c: DealCheck; cards: number[] } {
  const cards = Array.from(parser.parseHand(hand));
  const d = host.handle({ kind: "dealCheck", cards, bet });
  if (d.kind !== "dealCheck") throw new Error();
  return { c: d.check, cards };
}
/** Mask of the named cards within the hand string. */
function mask(hand: string, held: string): number {
  const cs = hand.split(" ");
  return held.split(" ").reduce((m, h) => m | (1 << cs.indexOf(h)), 0);
}

beforeAll(async () => {
  await init({ module_or_path: readFileSync(new URL("../src/wasm/ovp_engine_bg.wasm", import.meta.url)) });
  host = new EngineHost({ catalog, builtin: (id) => Engine.builtin(id) });
  host.handle({ kind: "load", paytableId: "jacks-or-better-9-6" });
  parser = Engine.builtin("jacks-or-better-9-6");
  beginner = await loadPresetStrategy("jacks-or-better-9-6", "beginner");
  host.handle({ kind: "setTrainerStrategy", text: beginner });
});

describe("deal check and grading", () => {
  const H = "Ah Kh 7c 7d 2s";
  it("strategy mode: green / yellow (next rule) / red / off-strategy", () => {
    const { c } = check(H);
    const s = c.strategy!;
    expect(s.ruleText).toBe("pair");
    expect(s.hold).toBe(mask(H, "7c 7d"));
    const g = (held: string) => gradeHold(c, held ? mask(H, held) : 0, "strategy", 0);
    expect(g("7c 7d")).toMatchObject({ correct: true, color: "green", distance: 0, cost: 0 });
    expect(g("Ah Kh")).toMatchObject({ correct: false, color: "yellow", distance: 1 });
    expect(g("Ah Kh").cost).toBeCloseTo(c.evs[s.hold] - c.evs[mask(H, "Ah Kh")], 12);
    expect(g("Ah")).toMatchObject({ color: "red", distance: 3 });
    expect(g("7c 7d Ah")).toMatchObject({ color: "red", distance: null });
    expect(g("")).toMatchObject({ color: "red" }); // discard everything: last matching rule
    // Distances are positions in the per-hand list, not in the printed strategy.
    expect(s.matching.map((m) => m.text)).toEqual(["pair", "2 high cards suited prefer low", "2 high cards prefer low", "1 high card prefer low", "discard everything"]);
  });

  it("pure EV: right within the grace margin, scaled with bet", () => {
    const { c } = check(H);
    const ak = mask(H, "Ah Kh");
    const gap = c.evs[c.best] - c.evs[ak];
    expect(gap).toBeGreaterThan(0);
    expect(gradeHold(c, ak, "ev", gap + 1e-9).correct).toBe(true);
    expect(gradeHold(c, ak, "ev", gap - 1e-6).correct).toBe(false);
    expect(gradeHold(c, c.best, "ev", 0)).toMatchObject({ correct: true, color: "green" });
    expect(graceAt(0.05, 5, 5)).toBe(0.05);
    expect(graceAt(0.05, 1, 5)).toBeCloseTo(0.01, 15);
  });

  it("exactly tied holds are the same play", () => {
    const hand = "2c 2d 7h 9s Js";
    const { c } = check(hand);
    expect(samePlay(c, mask(hand, "2c"), mask(hand, "2d"))).toBe(true);
    expect(samePlay(c, mask(hand, "2c"), mask(hand, "7h"))).toBe(false);
    // A synthetic tie with the strategy hold grades green in both modes.
    const tied: DealCheck = { ...c, tie: c.tie.map((t, m) => (m === 1 ? c.tie[c.strategy!.hold] : t)) };
    const evs = c.evs.slice();
    evs[1] = evs[c.strategy!.hold];
    expect(gradeHold({ ...tied, evs }, 1, "strategy", 0).color).toBe("green");
  });

  it("without a strategy, checking falls back to pure EV", () => {
    host.handle({ kind: "setTrainerStrategy", text: "" });
    const { c } = check(H);
    host.handle({ kind: "setTrainerStrategy", text: beginner });
    expect(c.strategy).toBeNull();
    const g = gradeHold(c, mask(H, "Ah Kh"), "strategy", 0);
    expect(g.expected).toBe(c.best);
    expect(g.distance).toBeNull();
  });
});

describe("trainer flow", () => {
  const H = "Ah Kh 7c 7d 2s";
  function setup(mode: TrainerSettings["mode"]) {
    const { c, cards } = check(H);
    let resolve!: (r: CheckResult) => void;
    const recs: HandRecord[] = [];
    const t = new Trainer(
      () => new Promise((r) => (resolve = r)),
      () => ({ mode, checking: "strategy", grace: 0.05, maxBet: 5 }),
      (r) => recs.push(r),
    );
    t.dealt(cards, 5);
    const arrive = async () => {
      resolve({ check: c, strategyKey: "jacks-or-better-9-6/beginner" });
      await Promise.resolve();
      await Promise.resolve();
    };
    const held = (cs: string) => [0, 1, 2, 3, 4].map((i) => (((cs ? mask(H, cs) : 0) >> i) & 1) === 1);
    return { t, c, recs, arrive, held };
  }

  it("lesson: blocks, then names the rule, then marks the cards", async () => {
    const { t, recs, arrive, held, c } = setup("lesson");
    expect(t.gate(held("Ah Kh"))).toBe("wait"); // check not back yet
    await arrive();
    expect(t.gate(held("Ah Kh"))).toBe("block");
    expect(t.lesson).toEqual({ message: "NOT THE BEST HOLD - TRY AGAIN", hint: null });
    expect(t.gate(held("Ah"))).toBe("block");
    expect(t.lesson?.message).toBe("USE: PAIR");
    expect(t.gate(held(""))).toBe("block");
    expect(t.lesson).toEqual({ message: "HOLD THE MARKED CARDS", hint: c.strategy!.hold });
    expect(t.gate(held("Ah Kh"))).toBe("block");
    expect(t.gate(held("7c 7d"))).toBe("allow");
    expect(t.lesson).toBeNull();
    t.drawn(0, "No win");
    // Stats judge the first hold the player tried.
    expect(recs).toHaveLength(1);
    expect(recs[0].hold).toBe(mask(H, "Ah Kh"));
    expect(t.feedback).toBeNull(); // no feedback box in Lesson
  });

  it("lesson: a correct first hold just draws", async () => {
    const { t, recs, arrive, held } = setup("lesson");
    await arrive();
    expect(t.gate(held("7c 7d"))).toBe("allow");
    t.drawn(5, "Jacks or Better");
    expect(recs[0]).toMatchObject({ hold: mask(H, "7c 7d"), won: 5, result: "Jacks or Better" });
  });

  it("practice: never blocks; feedback appears even if the check is late", async () => {
    const { t, recs, arrive, held } = setup("practice");
    expect(t.gate(held("Ah Kh"))).toBe("allow");
    t.drawn(0, "No win");
    expect(recs).toHaveLength(0);
    await arrive();
    expect(recs).toHaveLength(1);
    expect(t.feedback).toMatchObject({ color: "yellow", title: "CLOSE", rule: "pair" });
    expect(t.feedback!.cost).toBeGreaterThan(0);
  });

  it("free play: no feedback, still recorded", async () => {
    const { t, recs, arrive, held } = setup("free");
    await arrive();
    expect(t.gate(held("7c 7d Ah"))).toBe("allow");
    t.drawn(0, "No win");
    expect(t.feedback).toBeNull();
    expect(recs).toHaveLength(1);
  });
});

describe("game app with the trainer", () => {
  it("lesson mode holds the draw until the hold is right; a queued draw runs when the check arrives", async () => {
    (globalThis as unknown as { requestAnimationFrame: () => number }).requestAnimationFrame = () => 1;
    const wasm = WasmRules.builtin("jacks-or-better-9-6");
    const table = { wasm, label: "JOB", lineNames: Array.from(wasm.lineNames()) };
    const pix = new Pix({} as CanvasRenderingContext2D);
    let n = 0;
    const app = new GameApp(pix, table, null, 1000, 5, 4, new Sfx(true, 0), (k) => (n++ * 7) % k);
    let pending: (() => void) | null = null;
    const trainer = new Trainer(
      (cards, bet) =>
        new Promise((resolve) => {
          pending = () => {
            const d = host.handle({ kind: "dealCheck", cards, bet });
            if (d.kind === "dealCheck") resolve({ check: d.check, strategyKey: "k" });
          };
        }),
      () => ({ mode: "lesson", checking: "strategy", grace: 0.05, maxBet: 5 }),
      () => {},
    );
    app.attachTrainer(trainer, () => "lesson");
    app.press("dealDraw");
    expect(app.state.phase).toBe("dealt");
    app.press("dealDraw"); // before the check: queued, not drawn
    expect(app.state.phase).toBe("dealt");
    pending!();
    await new Promise((r) => setTimeout(r, 0));
    const c = (await new Promise<DealCheck>((r) => {
      const d = host.handle({ kind: "dealCheck", cards: app.state.hands[0].cards, bet: 5 });
      if (d.kind === "dealCheck") r(d.check);
    })) as DealCheck;
    // This seeded deal has a hold to make, so drawing with none is blocked.
    expect(samePlay(c, 0, c.strategy!.hold)).toBe(false);
    expect(app.state.phase).toBe("dealt");
    expect(trainer.lesson?.message).toBe("NOT THE BEST HOLD - TRY AGAIN");
    // Enter the strategy's hold and draw.
    const want = c.strategy!.hold;
    for (let i = 0; i < 5; i++) if (((want >> i) & 1) !== Number(app.state.hands[0].held[i])) app.press(`hold${i + 1}` as never);
    expect(heldMask(app.state.hands[0].held)).toBe(want);
    app.press("dealDraw");
    expect(app.state.phase).toBe("ready");
    expect(app.state.handsPlayed).toBe(1);
  });
});

describe("stats", () => {
  it("sums the three EV losses, deviations, distances and per-rule tallies", () => {
    const H = "Ah Kh 7c 7d 2s";
    const { c } = check(H);
    const a = emptyAgg(0);
    const base = { bet: 5, won: 0, result: "No win", check: c, strategyKey: "s" };
    record(a, { ...base, hold: mask(H, "7c 7d") });
    record(a, { ...base, hold: mask(H, "Ah Kh") });
    record(a, { ...base, hold: mask(H, "7c 7d Ah"), won: 10, result: "Two Pair" });
    const s = c.strategy!;
    const ev = (h: string) => c.evs[mask(H, h)];
    expect(a.hands).toBe(3);
    expect(a.wagered).toBe(15);
    expect(a.won).toBe(10);
    expect(a.results).toEqual({ "No win": 2, "Two Pair": 1 });
    expect(a.deviations).toBe(2);
    expect(a.distance).toMatchObject({ "0": 1, "1": 1, off: 1 });
    expect(a.rules.s.pair).toEqual({ opportunities: 3, misses: 2 });
    const best = c.evs[c.best];
    expect(a.lossVsOptimal).toBeCloseTo(3 * best - ev("7c 7d") - ev("Ah Kh") - ev("7c 7d Ah"), 12);
    expect(a.strategyLoss).toBeCloseTo(3 * (best - c.evs[s.hold]), 12);
    // (1) = (2) + (3), as SPEC §5.4 notes.
    expect(a.lossVsOptimal).toBeCloseTo(a.lossVsStrategy + a.strategyLoss, 12);
  });

  it("persist, reload and reset", async () => {
    const H = "Ah Kh 7c 7d 2s";
    const { c } = check(H);
    const kv = new MemoryKv();
    const s1 = new Stats(kv, 0);
    await s1.load();
    s1.add({ bet: 5, won: 0, result: "No win", check: c, hold: 0, strategyKey: "s" });
    await s1.flush();
    const s2 = new Stats(kv, 0);
    await s2.load();
    expect(s2.book.session.hands).toBe(1);
    expect(s2.book.lifetime.hands).toBe(1);
    s2.reset("session");
    await s2.flush();
    const s3 = new Stats(kv, 0);
    await s3.load();
    expect(s3.book.session.hands).toBe(0);
    expect(s3.book.lifetime.hands).toBe(1);
    // Malformed saved data starts fresh.
    await kv.set("lifetime", { version: 1, hands: "lots" });
    const s4 = new Stats(kv, 0);
    await s4.load();
    expect(s4.book.lifetime.hands).toBe(0);
    expect(reviveAgg(null)).toBeNull();
  });
});

describe("trainer UI helpers", () => {
  it("wraps rule names for the feedback box", () => {
    expect(wrap("2 HIGH CARDS SUITED PREFER LOW", 12)).toEqual(["2 HIGH CARDS", "SUITED", "PREFER LOW"]);
    expect(wrap("ROYAL FLUSH, STRAIGHT FLUSH", 12)).toEqual(["ROYAL FLUSH,", "STRAIGHT", "FLUSH"]);
    expect(wrap("ABCDEFGHIJKLMNO", 12)).toEqual(["ABCDEFGHIJKL", "MNO"]);
  });
  it("reads rule order from a strategy file", () => {
    const order = strategyRuleOrder(beginner);
    expect(order[0]).toMatch(/^royal flush/);
    expect(order.at(-1)).toBe("discard everything");
  });
  it("keeps trainer prefs across reloads and rejects bad values", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const p = loadPrefs(store);
    expect(p).toMatchObject({ mode: "practice", checking: "strategy", grace: 0.05, tier: "intermediate" });
    savePrefs(store, { ...p, mode: "lesson", checking: "ev", grace: 0.1, tier: "expert" });
    expect(loadPrefs(store)).toMatchObject({ mode: "lesson", checking: "ev", grace: 0.1, tier: "expert" });
    m.set("ovp.prefs.v1", JSON.stringify({ mode: "casino", grace: -1, tier: "guru" }));
    expect(loadPrefs(store)).toMatchObject({ mode: "practice", grace: 0.05, tier: "intermediate" });
  });
});
