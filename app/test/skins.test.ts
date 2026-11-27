// Skins: card faces and backs, themes and prefs, sound packs.
import { describe, expect, it, vi } from "vitest";
import { Pix } from "../src/render/pix";
import { LAYOUT } from "../src/config/feel";
import { TRILL } from "../src/config/skins";
import { BACKS, FACES, MIXED, SOUNDS, THEMES, pickTheme, resolveSkin, themeLabel } from "../src/skins/registry";
import { BASIC_SOUNDS } from "../src/skins/basic";
import { CLASSIC_SOUNDS, payoutNotes } from "../src/skins/sounds";
import { ART_H, ART_W, INDEX, faceRows } from "../src/skins/classic";
import { BACKS as DESIGNS, backRaster } from "../src/skins/art/backs";
import { courtPlan, courtRaster } from "../src/skins/art/court";
import { CardRenderer, type Surface } from "../src/skins/cards";
import { Sfx } from "../src/audio/sfx";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "../src/ui/prefs";
import { RecordingCtx } from "./recording";

const C = LAYOUT.cards;

/** Device rects drawn, as numbers. */
function rects(ctx: RecordingCtx) {
  return ctx.calls.filter((c) => !c.startsWith("img")).map((c) => c.split(" ").slice(1).map(Number));
}

describe("card skins", () => {
  it("every face skin draws all 52 cards (and flip widths) inside the card", () => {
    for (const f of FACES)
      for (const w of [C.w, 40, 9, 2])
        for (let suit = 0; suit < 4; suit++)
          for (let rank = 2; rank <= 14; rank++) {
            const ctx = new RecordingCtx();
            const p = new Pix(ctx as unknown as CanvasRenderingContext2D);
            p.k = 2.6667;
            p.ox = 13;
            p.oy = 7;
            const x = 20 + (C.w - w) / 2;
            expect(() => f.draw(p, x, 30, w, C.h, rank, suit)).not.toThrow();
            const r = rects(ctx);
            expect(r.length, `${f.id} ${rank}/${suit}`).toBeGreaterThan(0);
            const [x0, y0, x1, y1] = [p.devX(x), p.devY(30), p.devX(x + w), p.devY(30 + C.h)];
            for (const [rx, ry, rw, rh] of r) {
              expect(rx >= x0 && ry >= y0 && rx + rw <= x1 && ry + rh <= y1, `${f.id} ${rank}/${suit} w=${w}: ${rx},${ry} ${rw}x${rh}`).toBe(true);
            }
          }
  });

  it("every back draws inside the card at every flip width", () => {
    expect(BACKS.length).toBeGreaterThanOrEqual(6); // 5+ new designs and the classic
    for (const b of BACKS)
      for (const w of [C.w, 48, 20, 6, 2]) {
        const ctx = new RecordingCtx();
        const p = new Pix(ctx as unknown as CanvasRenderingContext2D);
        p.k = 4;
        p.ox = 0;
        const x = 10 + (C.w - w) / 2;
        expect(() => b.draw(p, x, 5, w, C.h)).not.toThrow();
        for (const [rx, ry, rw, rh] of rects(ctx)) expect(rx >= p.devX(x) && ry >= p.devY(5) && rx + rw <= p.devX(x + w) && ry + rh <= p.devY(5 + C.h), `${b.id} w=${w}`).toBe(true);
      }
  });

  it("procedural backs are symmetric under a half turn, and distinct", () => {
    const seen = new Set<string>();
    for (const d of DESIGNS) {
      const rows = backRaster(d, ART_W, ART_H).rows();
      const turned = [...rows].reverse().map((r) => [...r].reverse().join(""));
      expect(turned, d.id).toEqual(rows);
      seen.add(rows.join("\n"));
      // A white border margin all round.
      expect(rows[3].slice(10, -10), d.id).toMatch(/^f+$/);
      expect(rows.map((r) => r[3]).slice(10, -10).join(""), d.id).toMatch(/^f+$/);
    }
    expect(seen.size).toBe(DESIGNS.length);
    // The Classic theme's back uses the cabinet's red, blue and yellow.
    const def = DESIGNS.find((d) => d.id === THEMES.find((t) => t.id === "classic")!.backs)!;
    expect(Object.values(def.palette)).toEqual(expect.arrayContaining(["#c81818", "#1830c8", "#ffd800"]));
  });

  it("court portraits are deterministic and distinct across ranks and suits", () => {
    const all = new Map<string, string>();
    for (const rank of [11, 12, 13] as const)
      for (let suit = 0; suit < 4; suit++) {
        const a = courtRaster(courtPlan(rank, suit), 72, 80).rows().join("\n");
        const b = courtRaster(courtPlan(rank, suit), 72, 80).rows().join("\n");
        expect(a).toBe(b); // same seed, same pixels
        all.set(`${rank}/${suit}`, a);
      }
    expect(new Set(all.values()).size).toBe(12);
    // A different seed gives a different variation.
    expect(courtRaster(courtPlan(13, 2, 1), 72, 80).rows().join("\n")).not.toBe(all.get("13/2"));
    // Kings, queens and jacks differ in kind, not only colour.
    expect(courtPlan(13, 0).held).not.toBe(courtPlan(12, 0).held);
    expect(courtPlan(12, 0).held).not.toBe(courtPlan(11, 0).held);
    // The A♠ is its own ornate design (gold filigree, red ribbon); the other
    // aces use the number-card layout (one large pip, no gold or ribbon).
    const count = (rows: string[], k: string) => [...rows.join("")].filter((c) => c === k).length;
    expect(count(faceRows(14, 3), "y")).toBeGreaterThan(200);
    expect(count(faceRows(14, 3), "r")).toBeGreaterThan(100);
    for (const suit of [0, 1, 2]) expect(count(faceRows(14, suit), "y"), `A of suit ${suit}`).toBe(0);
  });

  it("indexes are legible: enough contrast against the face, and drawn in the index corner", () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    for (const f of FACES)
      for (let suit = 0; suit < 4; suit++) {
        const { ink, paper } = f.indexColors(suit);
        expect(contrast(ink, paper), `${f.id} suit ${suit}`).toBeGreaterThanOrEqual(4.5);
      }
    // Default: the rank and suit index really is there, in ink, top left.
    for (let suit = 0; suit < 4; suit++)
      for (let rank = 2; rank <= 14; rank++) {
        const rows = faceRows(rank, suit);
        const ink = suit === 1 || suit === 2 ? "r" : "k";
        const corner = rows.slice(INDEX.y, INDEX.suitY + INDEX.suitW).map((r) => r.slice(INDEX.x, INDEX.x + 26)).join("");
        expect([...corner].filter((k) => k === ink).length, `${rank}/${suit}`).toBeGreaterThan(60);
      }
  });

  it("the cache renders each card once per scale, blits it, and squeezes it mid-flip", () => {
    const made: RecordingCtx[] = [];
    const surface = (w: number, h: number): Surface => {
      const ctx = new RecordingCtx();
      made.push(ctx);
      return { width: w, height: h, getContext: () => ctx as unknown as CanvasRenderingContext2D };
    };
    const s = resolveSkin(pickTheme("classic"));
    const cards = new CardRenderer(s.faces, s.backs, surface);
    const screen = new RecordingCtx();
    const p = new Pix(screen as unknown as CanvasRenderingContext2D);
    p.fit(1280, 720);
    cards.face(p, 10, 137, C.w, 14, 3);
    cards.face(p, 10, 137, C.w, 14, 3);
    cards.face(p, 30, 137, 20, 14, 3); // mid-flip
    expect(cards.renders).toBe(1);
    const imgs = screen.calls.filter((c) => c.startsWith("img"));
    expect(imgs).toHaveLength(3);
    const width = (c: string) => Number(c.split(" ")[7]);
    expect(width(imgs[2])).toBeLessThan(width(imgs[0]));
    // A new scale (resize) drops the cache.
    p.fit(1920, 1080);
    cards.face(p, 10, 137, C.w, 14, 3);
    expect(cards.renders).toBe(2);
    // Changing the skin drops it too; Basic is drawn directly (no cache).
    const basic = resolveSkin(pickTheme("basic"));
    cards.setSkin(basic.faces, basic.backs);
    const before = screen.calls.length;
    cards.back(p, 10, 137, C.w);
    expect(screen.calls.slice(before).some((c) => c.startsWith("img"))).toBe(false);
    expect(cards.renders).toBe(2);
  });
});

describe("themes and prefs", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it("new players and old saved prefs get the default theme (Basic)", () => {
    expect(DEFAULT_PREFS).toMatchObject({ theme: "basic", faces: "basic", backs: "basic", sounds: "basic" });
    const s = store();
    s.m.set("ovp.prefs.v1", JSON.stringify({ paytableId: "bonus-poker-8-5", speed: 3, muted: false })); // saved before skins
    const p = loadPrefs(s);
    expect(p).toMatchObject({ paytableId: "bonus-poker-8-5", theme: "basic", faces: "basic", backs: "basic", sounds: "basic" });
  });

  it("choices saved under the old names carry over (Default became Classic)", () => {
    const s = store();
    s.m.set("ovp.prefs.v1", JSON.stringify({ theme: "default", faces: "default", backs: "classic", sounds: "default" }));
    const p = loadPrefs(s);
    expect(p).toMatchObject({ theme: "classic", faces: "classic", backs: "basic", sounds: "classic" });
    expect(themeLabel(p)).toBe(MIXED); // the Classic deck with Basic's back
    s.m.set("ovp.prefs.v1", JSON.stringify({ theme: "default", faces: "default", backs: "lattice", sounds: "default" }));
    expect(themeLabel(loadPrefs(s))).toBe("Classic");
  });

  it("saves and restores the choice, including a mixed one", () => {
    const s = store();
    const p = { ...loadPrefs(s), ...pickTheme("basic"), backs: "stars" };
    savePrefs(s, p);
    const q = loadPrefs(s);
    expect(q).toMatchObject({ theme: "basic", faces: "basic", backs: "stars", sounds: "basic" });
    expect(themeLabel(q)).toBe(MIXED);
    expect(resolveSkin(q).backs.id).toBe("stars");
  });

  it("unknown ids fall back to the theme's part, never a crash", () => {
    const s = store();
    s.m.set("ovp.prefs.v1", JSON.stringify({ theme: "basic", faces: "no-such-faces", backs: 42, sounds: "gone" }));
    const p = loadPrefs(s);
    const skin = resolveSkin(p);
    expect(skin.faces.id).toBe("basic");
    expect(skin.backs.id).toBe("basic");
    expect(skin.sounds.id).toBe("basic");
    // An unknown theme falls back to the default theme (Basic).
    expect(resolveSkin({ theme: "neon" }).faces.id).toBe("basic");
    expect(themeLabel({ theme: "basic", faces: "no-such-faces" })).toBe("Basic");
  });

  it("picking a theme sets all three parts; changing one shows Custom (mixed)", () => {
    for (const t of THEMES) {
      const c = pickTheme(t.id);
      expect(themeLabel(c)).toBe(t.name);
      expect(themeLabel({ ...c, sounds: SOUNDS.find((x) => x.id !== c.sounds)!.id })).toBe(MIXED);
      expect(themeLabel({ ...c, faces: FACES.find((x) => x.id !== c.faces)!.id })).toBe(MIXED);
    }
  });
});

/** A minimal Web Audio mock that records scheduling. */
class Param {
  events: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) {
    this.events.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(["lin", v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(["exp", v, t]);
  }
}
class Node {
  disconnected = false;
  connect(n: unknown) {
    return n;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class Osc extends Node {
  type = "sine";
  frequency = new Param();
  detune = new Param();
  t0 = NaN;
  stops: number[] = [];
  onended: (() => void) | null = null;
  start(t: number) {
    this.t0 = t;
  }
  stop(t: number) {
    this.stops.push(t);
  }
}
class Gain extends Node {
  gain = new Param();
}
class MockAudio {
  currentTime = 5;
  state = "running";
  destination = new Node();
  oscs: Osc[] = [];
  gains: Gain[] = [];
  createOscillator() {
    const o = new Osc();
    this.oscs.push(o);
    return o;
  }
  createGain() {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  resume() {}
}

function mockSfx(pack = CLASSIC_SOUNDS, muted = false) {
  const ac = new MockAudio();
  let made = 0;
  const sfx = new Sfx(muted, 0.5, pack, () => {
    made++;
    return ac as unknown as AudioContext;
  });
  return { ac, sfx, made: () => made };
}

describe("sound packs", () => {
  const cue = { atMs: 300, durMs: 1200, amount: 45, bet: 5, big: false, top: false };

  it("the trill rings two alternating pitches at the configured rate, only inside the count-up", () => {
    const { ac, sfx } = mockSfx();
    sfx.payout(cue);
    const t0 = ac.currentTime + cue.atMs / 1000;
    const t1 = t0 + cue.durMs / 1000;
    expect(ac.oscs.length).toBeGreaterThan(0);
    for (const o of ac.oscs) {
      expect(o.t0).toBeGreaterThanOrEqual(t0 - 1e-9);
      expect(Math.max(...o.stops)).toBeLessThanOrEqual(t1 + 0.006);
    }
    const notes = payoutNotes(cue).notes;
    expect(notes.length).toBe(Math.ceil((cue.durMs / 1000) * TRILL.rate));
    expect(new Set(notes.map((n) => n.freq))).toEqual(new Set(TRILL.pitches));
    expect(notes[0].freq).not.toBe(notes[1].freq);
    // Scales with the count-up (win size and speed slider decide durMs).
    expect(payoutNotes({ ...cue, durMs: 400 }).notes.length).toBeLessThan(notes.length);
  });

  it("big wins ring brighter; the royal opens with a fanfare", () => {
    const big = payoutNotes({ ...cue, big: true }).notes;
    expect(Math.min(...big.map((n) => n.freq))).toBeGreaterThan(Math.min(...TRILL.pitches));
    const royal = payoutNotes({ ...cue, durMs: 3000, top: true }).notes;
    expect(royal.slice(0, TRILL.fanfare.notes.length).map((n) => n.freq)).toEqual(TRILL.fanfare.notes);
    // Instant speed (no count-up): one ding.
    expect(payoutNotes({ ...cue, durMs: 0 }).notes).toHaveLength(1);
  });

  it("a bet or deal cancels the trill at once", () => {
    const { ac, sfx } = mockSfx();
    sfx.payout(cue);
    const scheduled = ac.oscs.length;
    ac.currentTime = 5.5; // mid count-up
    sfx.cancelPayout();
    for (const o of ac.oscs.slice(0, scheduled)) expect(o.stops).toContain(5.5);
    expect(ac.gains[0].disconnected).toBe(true); // the payout bus
    // A bet afterwards still sounds (on a fresh bus).
    sfx.bet();
    expect(ac.oscs.length).toBeGreaterThan(scheduled);
  });

  it("the game cancels the payout sound on a bet or a deal", async () => {
    const { GameApp } = await import("../src/game/app");
    const { Rules: WasmRules, default: init } = await import("../src/wasm/ovp_engine.js");
    const { readFileSync } = await import("node:fs");
    await init({ module_or_path: readFileSync(new URL("../src/wasm/ovp_engine_bg.wasm", import.meta.url)) });
    (globalThis as unknown as { requestAnimationFrame: () => number }).requestAnimationFrame = () => 1;
    const wasm = WasmRules.builtin("jacks-or-better-9-6");
    const { sfx } = mockSfx();
    const app = new GameApp(new Pix({} as CanvasRenderingContext2D), { wasm, label: "J", lineNames: Array.from(wasm.lineNames()) }, null, 1000, 1, 4, sfx);
    const spy = vi.spyOn(sfx, "cancelPayout");
    app.press("betOne");
    expect(spy).toHaveBeenCalledTimes(1);
    app.press("dealDraw");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("muted: no AudioContext is ever created", () => {
    const { sfx, made } = mockSfx(CLASSIC_SOUNDS, true);
    sfx.cards([0, 30]);
    sfx.hold(true);
    sfx.bet();
    sfx.payout(cue);
    sfx.cancelPayout();
    expect(made()).toBe(0);
    expect(sfx.contexts).toBe(0);
  });

  it("the Basic pack schedules exactly the original sounds", () => {
    const { ac, sfx } = mockSfx(BASIC_SOUNDS);
    sfx.payout({ ...cue, big: true });
    // Original: win(at, big) = 5 square notes 70 ms apart; countUp(at + 200, dur).
    const t = ac.currentTime + cue.atMs / 1000;
    const want: [string, number, number][] = [523, 659, 784, 1047, 1319].map((f, i) => ["square", f, t + i * 0.07]);
    const n = Math.min(24, Math.max(1, Math.round(cue.durMs / 40)));
    for (let i = 0; i < n; i++) want.push(["square", 1200, (ac.currentTime * 1000 + cue.atMs + 200 + (i * cue.durMs) / n) / 1000]);
    const got = ac.oscs.map((o) => [o.type, o.frequency.events[0][1], o.t0]);
    expect(got.length).toBe(want.length);
    got.forEach((g, i) => {
      expect(g[0]).toBe(want[i][0]);
      expect(g[1]).toBe(want[i][1]);
      expect(g[2]).toBeCloseTo(want[i][2], 9);
    });
  });
});
