// Visual timeline for the cabinet: card flips and the credit count-up.
// It never delays the game: state changes immediately, and a new event
// simply reschedules (any unfinished animation jumps to its end).

import { countUpMs, SPEED_TABLE, WIN_FLASH_MS } from "../config/feel";
import type { GameEvent, GameState } from "../game/model";

export interface CardLook {
  /** Show the face (false = back). */
  face: boolean;
  /** Horizontal squeeze 0..1 during a flip (1 = full width). */
  width: number;
}

export class Anim {
  private flipStart: number[] = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
  private count: { from: number; to: number; winTo: number; start: number; dur: number } | null = null;
  private flash: { category: number; start: number } | null = null;
  private end = 0;

  constructor(public speed: number) {}

  private get t() {
    return SPEED_TABLE[this.speed] ?? SPEED_TABLE[4];
  }

  onEvents(events: GameEvent[], now: number) {
    const { cardStepMs, flipMs } = this.t;
    let revealEnd = now;
    for (const e of events) {
      switch (e.type) {
        case "deal":
          this.count = null;
          this.flash = null;
          for (let i = 0; i < 5; i++) this.flipStart[i] = now + i * cardStepMs;
          revealEnd = now + 4 * cardStepMs + flipMs;
          break;
        case "draw":
          e.replaced.forEach((card, j) => (this.flipStart[card] = now + j * cardStepMs));
          revealEnd = e.replaced.length ? now + (e.replaced.length - 1) * cardStepMs + flipMs : now;
          break;
        case "win": {
          const dur = countUpMs(this.speed, e.amount);
          this.count = { from: e.creditsBefore, to: e.creditsBefore + e.amount, winTo: e.amount, start: revealEnd, dur };
          this.flash = { category: e.category, start: revealEnd };
          break;
        }
      }
    }
    this.end = Math.max(this.end, revealEnd, this.count ? this.count.start + this.count.dur : 0);
  }

  /** True while something is moving (the renderer keeps animating). */
  busy(now: number): boolean {
    return now < this.end || this.flash !== null;
  }

  card(i: number, now: number): CardLook {
    const flipMs = this.t.flipMs;
    const s = this.flipStart[i];
    if (now < s) return { face: false, width: 1 };
    if (flipMs <= 0 || now >= s + flipMs) return { face: true, width: 1 };
    const p = (now - s) / flipMs;
    return p < 0.5 ? { face: false, width: 1 - p * 2 } : { face: true, width: (p - 0.5) * 2 };
  }

  /** Credits and win meters as displayed (counting up after a win). */
  meters(now: number, state: GameState): { credits: number; win: number } {
    const c = this.count;
    if (!c || state.phase !== "ready" || now >= c.start + c.dur) return { credits: state.credits, win: state.lastWin };
    if (now < c.start) return { credits: c.from, win: 0 };
    const p = c.dur === 0 ? 1 : (now - c.start) / c.dur;
    const added = Math.floor(c.winTo * p);
    return { credits: c.from + added, win: added };
  }

  /** Pay table row to flash (after a win), and whether it is lit now. */
  flashRow(now: number): { category: number; lit: boolean } | null {
    const f = this.flash;
    if (!f || now < f.start) return null;
    return { category: f.category, lit: Math.floor((now - f.start) / WIN_FLASH_MS) % 2 === 0 };
  }

  /** Ends the win flash (e.g. on the next deal). */
  clearFlash() {
    this.flash = null;
  }

  /** Jump every animation to its end. */
  finish() {
    this.flipStart = this.flipStart.map(() => -Infinity);
    if (this.count) {
      this.count.start = -Infinity;
      this.count.dur = 0;
    }
    this.end = 0;
  }
}
