// Milestone 4: game model, input layer, animation timeline, font, prefs.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import init, { Rules as WasmRules, catalog } from "../src/wasm/ovp_engine.js";
import { apply, initialState, shuffledDeck, type GameState, type Rng, type Rules } from "../src/game/model";
import { modelRules, payGrid } from "../src/game/rules";
import { DEFAULT_KEYMAP } from "../src/config/keymap";
import { KeyboardSource, keymapConflicts } from "../src/input/keyboard";
import { BUTTONS, buttonToAction } from "../src/input/actions";
import { Anim } from "../src/render/anim";
import { GLYPHS, SUITS, textWidth } from "../src/render/font";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "../src/ui/prefs";
import { countUpMs, SPEED_TABLE } from "../src/config/feel";

let job: Rules;
const opt = { startingCredits: 1000, autoRefill: true };

/** Seeded PRNG (mulberry32) for reproducible deals. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

beforeAll(async () => {
  await init({ module_or_path: readFileSync(new URL("../src/wasm/ovp_engine_bg.wasm", import.meta.url)) });
  job = modelRules(WasmRules.builtin("jacks-or-better-9-6"), null);
});

describe("game model", () => {
  it("deals five distinct cards and charges the bet", () => {
    const { state, events } = apply(initialState(1000, 5), { type: "dealDraw" }, job, seeded(1), opt);
    expect(state.phase).toBe("dealt");
    expect(state.credits).toBe(995);
    expect(new Set(state.hands[0].cards).size).toBe(5);
    expect(state.stock.length).toBe(47);
    expect(events[0].type).toBe("deal");
    // Model supports multiple hands and carried state; v1 uses one / none.
    expect(state.hands.length).toBe(1);
    expect(state.carry).toEqual({});
  });

  it("draws replacements from the stock in order, keeping held cards", () => {
    let s = apply(initialState(1000, 1), { type: "dealDraw" }, job, seeded(2), opt).state;
    s = apply(s, { type: "hold", index: 1 }, job, seeded(0), opt).state;
    s = apply(s, { type: "hold", index: 3 }, job, seeded(0), opt).state;
    const dealt = s.hands[0].cards;
    const stock = s.stock;
    const { state, events } = apply(s, { type: "dealDraw" }, job, seeded(0), opt);
    const fin = state.hands[0].cards;
    expect(fin[1]).toBe(dealt[1]);
    expect(fin[3]).toBe(dealt[3]);
    expect([fin[0], fin[2], fin[4]]).toEqual(stock.slice(0, 3));
    expect(events[0]).toEqual({ type: "draw", replaced: [0, 2, 4] });
    expect(state.phase).toBe("ready");
    expect(state.handsPlayed).toBe(1);
  });

  it("holds toggle and only work while a hand is dealt", () => {
    let s = initialState(1000, 1);
    expect(apply(s, { type: "hold", index: 0 }, job, seeded(0), opt).events[0].type).toBe("rejected");
    s = apply(s, { type: "dealDraw" }, job, seeded(3), opt).state;
    s = apply(s, { type: "hold", index: 0 }, job, seeded(0), opt).state;
    expect(s.hands[0].held[0]).toBe(true);
    s = apply(s, { type: "hold", index: 0 }, job, seeded(0), opt).state;
    expect(s.hands[0].held[0]).toBe(false);
  });

  it("Bet One cycles 1..max between hands; Bet Max bets max and deals", () => {
    let s = initialState(1000, 1);
    const bets: number[] = [];
    for (let i = 0; i < 6; i++) {
      s = apply(s, { type: "betOne" }, job, seeded(0), opt).state;
      bets.push(s.bet);
    }
    expect(bets).toEqual([2, 3, 4, 5, 1, 2]);
    const r = apply(s, { type: "betMax" }, job, seeded(4), opt);
    expect(r.state.bet).toBe(5);
    expect(r.state.phase).toBe("dealt");
    expect(apply(r.state, { type: "betOne" }, job, seeded(0), opt).events[0].type).toBe("rejected");
    expect(apply(r.state, { type: "betMax" }, job, seeded(0), opt).events[0].type).toBe("rejected");
  });

  it("refills when credits can't cover the bet (free play)", () => {
    const r = apply(initialState(3, 5), { type: "dealDraw" }, job, seeded(5), opt);
    expect(r.events[0]).toEqual({ type: "refill", credits: 1000 });
    expect(r.state.credits).toBe(995);
    const no = apply(initialState(3, 5), { type: "dealDraw" }, job, seeded(5), { ...opt, autoRefill: false });
    expect(no.events[0].type).toBe("rejected");
  });

  it("pays exactly the pay table over 5,000 seeded hands; credits balance", () => {
    const rng = seeded(42);
    let s: GameState = initialState(1_000_000, 5);
    let bets = 0;
    let wins = 0;
    for (let i = 0; i < 5000; i++) {
      s = apply(s, { type: "dealDraw" }, job, rng, opt).state;
      bets += s.bet;
      for (let c = 0; c < 5; c++) if (rng(2)) s = apply(s, { type: "hold", index: c }, job, rng, opt).state;
      const held = s.hands[0].held.slice();
      const dealt = s.hands[0].cards.slice();
      s = apply(s, { type: "dealDraw" }, job, rng, opt).state;
      const h = s.hands[0];
      expect(new Set(h.cards).size).toBe(5);
      held.forEach((k, c) => k && expect(h.cards[c]).toBe(dealt[c]));
      expect(h.category).toBe(job.category(h.cards));
      expect(h.win).toBe(job.pays(5)[h.category!]);
      wins += h.win;
    }
    expect(s.credits).toBe(1_000_000 - bets + wins);
    expect(s.handsPlayed).toBe(5000);
  });

  it("acts in well under a millisecond (input never waits)", () => {
    const rng = seeded(7);
    let s = initialState(1_000_000, 5);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) {
      s = apply(s, { type: "dealDraw" }, job, rng, opt).state;
      s = apply(s, { type: "hold", index: 0 }, job, rng, opt).state;
      s = apply(s, { type: "dealDraw" }, job, rng, opt).state;
    }
    expect((performance.now() - t0) / 6000).toBeLessThan(0.2);
  });

  it("shuffles are permutations of the whole deck", () => {
    const d = shuffledDeck(52, seeded(9));
    expect([...d].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
});

describe("rules adapter", () => {
  it("pays from the engine, with the progressive at max bet only", () => {
    const w = WasmRules.builtin("jacks-or-better-9-6");
    const royal = 0;
    expect(modelRules(w, null).pays(5)[royal]).toBe(4000);
    expect(modelRules(w, 6123).pays(5)[royal]).toBe(6123);
    expect(modelRules(w, 6123).pays(4)[royal]).toBe(1000);
    const grid = payGrid(modelRules(w, null), w.lineNames().length);
    expect(grid[royal]).toEqual([250, 500, 750, 1000, 4000]);
    expect(grid[8]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("input layer", () => {
  it("default keymap matches the spec and has no conflicts", () => {
    expect(DEFAULT_KEYMAP.hold1).toEqual(["KeyZ"]);
    expect(DEFAULT_KEYMAP.hold5).toEqual(["KeyB"]);
    expect(DEFAULT_KEYMAP.dealDraw).toEqual(["Comma"]);
    expect(DEFAULT_KEYMAP.betMax).toEqual(["KeyM"]);
    expect(DEFAULT_KEYMAP.betOne).toEqual(["KeyN"]);
    expect(keymapConflicts(DEFAULT_KEYMAP)).toEqual([]);
    expect(Object.keys(DEFAULT_KEYMAP).sort()).toEqual([...BUTTONS].sort());
  });

  it("maps keys to buttons; ignores repeats, modifiers, unknown keys, and a disabled source", () => {
    let fn: ((e: KeyboardEvent) => void) | null = null;
    const target = { addEventListener: (_: string, f: (e: KeyboardEvent) => void) => (fn = f), removeEventListener: () => (fn = null) };
    const src = new KeyboardSource(target, DEFAULT_KEYMAP);
    const got: string[] = [];
    src.start((b) => got.push(b));
    const ev = (code: string, extra: Partial<KeyboardEvent> = {}) =>
      ({ code, repeat: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, ...extra }) as KeyboardEvent;
    fn!(ev("KeyZ"));
    fn!(ev("Comma"));
    fn!(ev("KeyZ", { repeat: true }));
    fn!(ev("KeyM", { metaKey: true }));
    fn!(ev("KeyQ"));
    src.enabled = () => false;
    fn!(ev("KeyX"));
    expect(got).toEqual(["hold1", "dealDraw"]);
    src.setKeymap({ ...DEFAULT_KEYMAP, hold1: ["KeyA"] });
    src.enabled = () => true;
    fn!(ev("KeyA"));
    fn!(ev("KeyZ"));
    expect(got.slice(2)).toEqual(["hold1"]);
    expect(buttonToAction("hold3")).toEqual({ type: "hold", index: 2 });
  });
});

describe("animation timeline", () => {
  it("never holds the state back: meters end at the true credits", () => {
    const a = new Anim(1);
    const s = { ...initialState(100, 5), phase: "ready" as const, credits: 140, lastWin: 40 };
    a.onEvents([{ type: "draw", replaced: [0, 1] }, { type: "win", category: 7, amount: 40, creditsBefore: 100 }], 0);
    expect(a.meters(0, s).credits).toBe(100);
    expect(a.meters(10_000, s)).toEqual({ credits: 140, win: 40 });
    a.finish();
    expect(a.meters(0, s).credits).toBe(140);
  });

  it("the default (fast) speed finishes a whole hand's animation within the 2-second budget, even a royal", () => {
    const t = SPEED_TABLE[4];
    const deal = 4 * t.cardStepMs + t.flipMs;
    const draw = 4 * t.cardStepMs + t.flipMs;
    expect(deal + draw + countUpMs(4, 4000)).toBeLessThan(2000);
    expect(countUpMs(1, 4000)).toBeLessThanOrEqual(4000);
    const a = new Anim(5);
    a.onEvents([{ type: "deal", cards: [0, 1, 2, 3, 4] }], 0);
    expect(a.card(4, 0)).toEqual({ face: true, width: 1 });
  });
});

describe("pixel font", () => {
  it("draws every pay line name of every game and every screen message", () => {
    const names: string[] = [];
    for (const t of JSON.parse(catalog()).paytables as { id: string }[]) names.push(...WasmRules.builtin(t.id).lineNames());
    const texts = [...names, "WINNER! GAME OVER PLAY 1 TO 5 CREDITS HELD WIN BET CREDIT 0123456789 JACKS+ POKER 9/6/4 10"];
    for (const s of texts) for (const ch of s.toUpperCase()) expect(GLYPHS[ch], `glyph '${ch}' in "${s}"`).toBeDefined();
    for (const g of Object.values(GLYPHS)) expect(g.length === 7 && g.every((r) => r.length === 5)).toBe(true);
    for (const s of SUITS) expect(s.length === 9 && s.every((r) => r.length === 9)).toBe(true);
    // Longest line name fits the pay table's name column.
    expect(Math.max(...names.map((n) => textWidth(n)))).toBeLessThan(150);
  });
});

describe("preferences", () => {
  it("survive a round trip and ignore garbage", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadPrefs(store)).toEqual(DEFAULT_PREFS);
    savePrefs(store, { ...DEFAULT_PREFS, speed: 2, muted: false, credits: 777, progressive: 5000 });
    const p = loadPrefs(store);
    expect([p.speed, p.muted, p.credits, p.progressive]).toEqual([2, false, 777, 5000]);
    m.set("ovp.prefs.v1", JSON.stringify({ speed: 99, credits: -5, keymap: { hold1: 3 }, volume: 7 }));
    expect(loadPrefs(store)).toEqual(DEFAULT_PREFS);
    m.set("ovp.prefs.v1", "{oops");
    expect(loadPrefs(store)).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => savePrefs(throwing, DEFAULT_PREFS)).not.toThrow();
  });
});
