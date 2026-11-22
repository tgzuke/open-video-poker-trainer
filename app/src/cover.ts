// itch.io cover image (630×500), drawn with the game's own pixel renderer,
// font and palette. Not part of the game build; regenerate with
// `npm run cover` (see docs/itch.md).
import { PALETTE as P } from "./config/feel";
import { FEEDBACK as F } from "./config/trainer";
import { RANK_TEXT, SUIT_IS_RED, textWidth } from "./render/font";
import { Pix } from "./render/pix";

/** Logical grid: 315×250, drawn at 2× = 630×500. */
const W = 315;
const H = 250;

const canvas = document.getElementById("cover") as HTMLCanvasElement;
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(630 * dpr);
canvas.height = Math.round(500 * dpr);
const p = new Pix(canvas.getContext("2d", { alpha: false })!);
p.k = 2 * dpr;

const centered = (s: string, y: number, scale: number, color: string, shadow?: string) => {
  const x = Math.round((W - textWidth(s, scale)) / 2);
  if (shadow) p.text(s, x + 1, y + 1, scale, shadow);
  p.text(s, x, y, scale, color);
};

// Field and frame.
p.rect(0, 0, W, H, P.frame);
p.rect(3, 3, W - 6, H - 6, P.field);

// Title.
centered("OPEN VIDEO POKER", 14, 3, P.payText, P.fieldDark);
centered("TRAINER", 42, 4, P.meterText, P.fieldDark);

// A dealt hand with 4 to a royal held.
const CARD = { w: 52, h: 72, gap: 8, y: 89 };
const hand: [number, number, boolean][] = [
  [14, 2, true],
  [13, 2, true],
  [12, 2, true],
  [11, 2, true],
  [7, 0, false],
];
const x0 = Math.round((W - (5 * CARD.w + 4 * CARD.gap)) / 2);
hand.forEach(([rank, suit, held], i) => {
  const x = x0 + i * (CARD.w + CARD.gap);
  const y = CARD.y;
  if (held) p.text("HELD", x + Math.round((CARD.w - textWidth("HELD")) / 2), y - 9, 1, P.held);
  p.rect(x + 1, y, CARD.w - 2, CARD.h, P.cardEdge);
  p.rect(x, y + 1, CARD.w, CARD.h - 2, P.cardEdge);
  p.rect(x + 1, y + 1, CARD.w - 2, CARD.h - 2, P.cardFace);
  const color = SUIT_IS_RED[suit] ? P.suitRed : P.suitBlack;
  p.text(RANK_TEXT[rank], x + 4, y + 4, 2, color);
  p.suit(suit, x + 4, y + 21, 1, color);
  p.suit(suit, x + Math.round((CARD.w - 27) / 2), y + 38, 3, color);
});

// Practice feedback lamp.
const lamp = { x: 20, y: 172, w: W - 40, h: 20 };
p.rect(lamp.x - 2, lamp.y - 2, lamp.w + 4, lamp.h + 4, P.frame);
p.rect(lamp.x, lamp.y, lamp.w, lamp.h, F.green);
centered("CORRECT: 4 TO A ROYAL", lamp.y + 3, 2, F.ink);

// Tagline.
centered("EXACT-MATH STRATEGY PRACTICE", 204, 1, P.white);
centered("BEGINNER - INTERMEDIATE - EXPERT", 216, 1, P.payText);
centered("FREE - PLAY CREDITS ONLY - NO REAL MONEY", 232, 1, P.payTextDim);

document.title = "cover ready";
