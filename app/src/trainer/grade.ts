// Grades one hold of a dealt hand (SPEC §5.1, §5.3). Pure; the exact math
// (EV ties, rule distance) comes from the engine's DealCheck.
import type { Checking } from "../config/trainer";
import type { DealCheck } from "../engine/protocol";

export type Color = "green" | "yellow" | "red";

export interface Grade {
  correct: boolean;
  color: Color;
  /** Rule distance; null = off-strategy (or no strategy loaded). */
  distance: number | null;
  /** The hold the checking mode expects. */
  expected: number;
  /** Name of the rule behind the expected hold, if any. */
  expectedRule: string | null;
  /** Credits given up against the expected hold (≥ 0 when wrong). */
  cost: number;
}

export function samePlay(c: DealCheck, a: number, b: number): boolean {
  return c.tie[a] === c.tie[b];
}

/** Pure EV grace in credits at this bet (the setting is at max bet). */
export function graceAt(graceAtMax: number, bet: number, maxBet: number): number {
  return (graceAtMax * bet) / maxBet;
}

/** Strategy checking needs a strategy; without one, Pure EV applies. */
export function effectiveChecking(c: DealCheck, checking: Checking): Checking {
  return c.strategy ? checking : "ev";
}

export function expectedHold(c: DealCheck, checking: Checking): number {
  return effectiveChecking(c, checking) === "strategy" ? c.strategy!.hold : c.best;
}

function ruleFor(c: DealCheck, hold: number, checking: Checking): string | null {
  const s = c.strategy;
  if (!s) return null;
  if (effectiveChecking(c, checking) === "strategy") return s.ruleText;
  const r = s.describes[hold];
  return r === null ? null : (s.matching.find((m) => m.rule === r)?.text ?? null);
}

/**
 * Strategy mode: correct iff the same play as the strategy (exact EV ties
 * count). Pure EV: correct iff within `grace` credits of the best hold.
 * Colors: green = correct; yellow = wrong but one rule away (distance 1);
 * red = two or more away, or off-strategy. In Pure EV mode a wrong play
 * that follows the strategy (distance 0) is also yellow.
 */
export function gradeHold(c: DealCheck, hold: number, checking: Checking, grace: number): Grade {
  const mode = effectiveChecking(c, checking);
  const expected = expectedHold(c, checking);
  const correct = mode === "strategy" ? samePlay(c, hold, expected) : c.evs[c.best] - c.evs[hold] <= grace + 1e-12;
  const distance = c.strategy ? c.strategy.distance[hold] : null;
  const color: Color = correct ? "green" : distance !== null && distance <= 1 ? "yellow" : "red";
  return {
    correct,
    color,
    distance,
    expected,
    expectedRule: ruleFor(c, expected, checking),
    cost: Math.max(0, c.evs[expected] - c.evs[hold]),
  };
}

export function heldMask(held: boolean[]): number {
  return held.reduce((m, h, i) => (h ? m | (1 << i) : m), 0);
}
