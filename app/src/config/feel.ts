// Everything about how the game FEELS lives here, for playtesting (SPEC
// CLAUDE.md: timing, layout, colors, sounds). Change values, not code.

/** Speed slider positions 1 (slow) … 5 (instant). Default: fast. */
export const SPEED_LEVELS = [1, 2, 3, 4, 5] as const;
export const DEFAULT_SPEED = 4;

/** Per speed level: ms between card reveals, ms per card flip, credits per
 *  second when counting up a win, and min/max count-up time. */
export const SPEED_TABLE: Record<number, { cardStepMs: number; flipMs: number; countPerSec: number; minCountMs: number; maxCountMs: number }> = {
  1: { cardStepMs: 120, flipMs: 90, countPerSec: 60, minCountMs: 400, maxCountMs: 4000 },
  2: { cardStepMs: 80, flipMs: 60, countPerSec: 150, minCountMs: 250, maxCountMs: 3000 },
  3: { cardStepMs: 50, flipMs: 40, countPerSec: 400, minCountMs: 150, maxCountMs: 2000 },
  4: { cardStepMs: 30, flipMs: 25, countPerSec: 1200, minCountMs: 80, maxCountMs: 1200 },
  5: { cardStepMs: 0, flipMs: 0, countPerSec: Infinity, minCountMs: 0, maxCountMs: 0 },
};

/** Count-up duration for a win at a speed level. */
export function countUpMs(speed: number, amount: number): number {
  const t = SPEED_TABLE[speed] ?? SPEED_TABLE[4];
  if (t.countPerSec === Infinity) return 0;
  return Math.min(t.maxCountMs, Math.max(t.minCountMs, (amount / t.countPerSec) * 1000));
}

export const STARTING_CREDITS = 1000;
/** When credits can't cover the bet, refill to STARTING_CREDITS (free play). */
export const AUTO_REFILL = true;

export const DEFAULT_SOUND = { muted: true, volume: 0.35 };

/** Win line flash period (ms) on the pay table. */
export const WIN_FLASH_MS = 400;

/** Cabinet palette (older bartop look: deep blue field, yellow/red/white). */
export const PALETTE = {
  field: "#0a1a8c",
  fieldDark: "#06105c",
  frame: "#c81818",
  frameLight: "#ff4a3a",
  payText: "#ffd800",
  payTextDim: "#b89a00",
  payHighlightBg: "#c81818",
  betColumnBg: "#1830c8",
  white: "#f8f8f0",
  meterText: "#ff3a2a",
  meterLabel: "#ffd800",
  held: "#ffd800",
  cardFace: "#f8f8f0",
  cardEdge: "#202020",
  cardBack: "#c81818",
  cardBackPattern: "#ffd800",
  suitRed: "#d01818",
  suitBlack: "#101010",
  message: "#ffffff",
  winMessage: "#ffd800",
};

/** Pixel grid the cabinet is laid out on (16:9). Scales to any window. */
export const SCREEN = { w: 480, h: 270 };

/** Cabinet layout on the SCREEN grid. */
export const LAYOUT = {
  payTable: { x: 30, y: 6, w: 420, h: 110, maxRowH: 11, nameX: 40, firstColRight: 238, colW: 50 },
  message: { y: 120 },
  held: { y: 128 },
  cards: { y: 137, w: 64, h: 88, gap: 14 },
  meters: { labelY: 232, valueY: 242, left: 30, right: 450 },
  gameLabel: { y: 259 },
};
