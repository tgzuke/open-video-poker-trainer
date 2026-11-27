// Cabinet rendering at the draw-call level: a recording 2D context
// captures every fillRect (with its colour) the cabinet makes, so the
// output can be compared exactly without a real canvas.
import { describe, expect, it } from "vitest";
import { drawCabinet, type CabinetView } from "../src/render/cabinet";
import { Anim } from "../src/render/anim";
import { Pix } from "../src/render/pix";
import { initialState, type GameState } from "../src/game/model";
import type { Mode } from "../src/config/trainer";

/** A 2D context that records what is drawn. */
export class RecordingCtx {
  calls: string[] = [];
  fillStyle = "#000";
  imageSmoothingEnabled = true;
  canvas = { width: 1280, height: 720 };
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`${this.fillStyle} ${x} ${y} ${w} ${h}`);
  }
  drawImage(...a: unknown[]) {
    this.calls.push(`img ${a.slice(1).join(" ")}`);
  }
}

export function hash(lines: string[]): string {
  let h = 0x811c9dc5;
  for (const l of lines)
    for (let i = 0; i < l.length; i++) {
      h ^= l.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  return h.toString(16).padStart(8, "0");
}

/** Card id c → rank 2..14, suit 0..3 (test mapping). */
const rank = (c: number) => 2 + (c % 13);
const suit = (c: number) => Math.floor(c / 13);

export function view(state: GameState, mode: Mode, extra: Partial<CabinetView> = {}): CabinetView {
  return {
    state,
    lineNames: ["ROYAL FLUSH", "STRAIGHT FLUSH", "4 OF A KIND", "FULL HOUSE", "FLUSH", "STRAIGHT", "3 OF A KIND", "TWO PAIR", "JACKS OR BETTER"],
    payGrid: [250, 50, 25, 9, 6, 4, 3, 2, 1].map((p) => [1, 2, 3, 4, 5].map((b) => (p === 250 && b === 5 ? 4000 : p * b))),
    label: "JACKS+ POKER 9/6",
    rank,
    suit,
    trainer: { mode, tag: null, feedback: null, lesson: null },
    ...extra,
  };
}

function dealt(cards: number[]): GameState {
  return { ...initialState(1000, 5), phase: "dealt", hands: [{ cards, held: [true, false, true, false, false], category: null, win: 0 }] };
}

/** Every card face (full width and mid-flip), backs at flip widths, an
 *  empty table, in Free Play and Practice, at two window sizes. */
export function cabinetFrames(extra: Partial<CabinetView> = {}): string[] {
  const out: string[] = [];
  for (const [w, h] of [
    [1280, 720],
    [1920, 1080],
  ]) {
    const ctx = new RecordingCtx();
    ctx.canvas = { width: w, height: h };
    const p = new Pix(ctx as unknown as CanvasRenderingContext2D);
    p.fit(w, h);
    for (const mode of ["free", "practice"] as Mode[]) {
      const idle = new Anim(4);
      drawCabinet(p, view(initialState(1000, 5), mode, extra), idle, 0);
      for (let start = 0; start < 52; start += 5) {
        const cards = [0, 1, 2, 3, 4].map((i) => (start + i) % 52);
        const anim = new Anim(4); // 30 ms between cards, 25 ms flips
        anim.onEvents([{ type: "deal", cards }], 0);
        for (const now of [0, 5, 10, 20, 33, 47, 61, 1000]) drawCabinet(p, view(dealt(cards), mode, extra), anim, now);
      }
    }
    for (const c of ctx.calls) out.push(c);
  }
  return out;
}

describe("cabinet draw calls", () => {
  it("Basic theme draws exactly what the cabinet drew before skins (golden)", () => {
    const calls = cabinetFrames();
    expect(calls.length).toBeGreaterThan(10000);
    // Recorded from the pre-skin renderer (commit 7f62fae, before skins) with the same frames.
    expect(hash(calls)).toBe("e194c3db");
  });
});
