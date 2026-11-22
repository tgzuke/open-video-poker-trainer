// Draws the whole cabinet screen from the game state and the animation.
import { LAYOUT, PALETTE as P, SCREEN } from "../config/feel";
import { FEEDBACK as F, type Mode } from "../config/trainer";
import type { Feedback, LessonPrompt } from "../trainer/trainer";
import { ruleDisplay } from "../trainer/ruleText";
import type { GameState } from "../game/model";
import type { Anim } from "./anim";
import { RANK_TEXT, SUIT_IS_RED, textWidth } from "./font";
import { Pix } from "./pix";

export interface CabinetView {
  state: GameState;
  /** Pay line names, upper-case. */
  lineNames: string[];
  /** Credits per line for bets 1..maxBet: payGrid[line][bet-1]. */
  payGrid: number[][];
  /** Game label + pay table name, e.g. "JACKS+ POKER 9/6". */
  label: string;
  rank(card: number): number;
  suit(card: number): number;
  trainer: TrainerView;
}

export interface TrainerView {
  mode: Mode;
  feedback: Feedback | null;
  lesson: LessonPrompt | null;
}

const C = LAYOUT.cards;

/** Left edge of card i; in Practice the cards sit left of the feedback box. */
export function cardX(i: number, mode: Mode = "free"): number {
  const total = 5 * C.w + 4 * C.gap;
  const left = mode === "practice" ? LAYOUT.practiceCardsX : (SCREEN.w - total) / 2;
  return left + i * (C.w + C.gap);
}

/** Splits text into lines of at most `max` characters, at spaces. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let w = word; w.length; ) {
      const piece = w.slice(0, max);
      w = w.slice(max);
      if (!line) line = piece;
      else if (line.length + 1 + piece.length <= max) line += " " + piece;
      else {
        out.push(line);
        line = piece;
      }
    }
  }
  if (line) out.push(line);
  return out;
}

/** Feedback box text line pitch (7 px glyphs + 1 px gap). */
export const FEEDBACK_LINE = 8;
/** Characters per feedback box line. */
export const FEEDBACK_CHARS = Math.floor((LAYOUT.feedback.w - 4) / 6);
/** Rule lines that fit under the "BEST PLAY" label (above the cost line). */
export const FEEDBACK_RULE_LINES = Math.floor((LAYOUT.feedback.h - 12 - 20) / FEEDBACK_LINE) - 1;

const COLORS = { green: F.green, yellow: F.yellow, red: F.red };

function drawFeedback(p: Pix, f: Feedback | null) {
  const B = LAYOUT.feedback;
  p.rect(B.x - 2, B.y - 2, B.w + 4, B.h + 4, P.frame);
  p.rect(B.x, B.y, B.w, B.h, F.boxBg);
  const max = FEEDBACK_CHARS;
  if (!f) {
    centered(p, "FEEDBACK", B.x + B.w / 2, B.y + Math.round(B.h / 2) - 3, 1, F.dim);
    return;
  }
  p.rect(B.x + 2, B.y + 2, B.w - 4, 13, COLORS[f.color]);
  centered(p, f.title, B.x + B.w / 2, B.y + 5, 1, F.ink);
  let y = B.y + 20;
  const lines: [string, string][] = [];
  if (f.rule) {
    lines.push([f.color === "green" ? "PLAYED" : "BEST PLAY", F.dim]);
    for (const l of wrap(ruleDisplay(f.rule).toUpperCase(), max)) lines.push([l, F.text]);
  }
  const room = Math.floor((B.y + B.h - 12 - y) / FEEDBACK_LINE);
  if (lines.length > room) {
    lines.length = room;
    lines[room - 1] = [lines[room - 1][0].slice(0, max - 2) + "..", F.text];
  }
  for (const [l, c] of lines) {
    p.text(l, B.x + 3, y, 1, c);
    y += FEEDBACK_LINE;
  }
  if (f.cost > 0) p.text(`COST ${f.cost.toFixed(2)}`, B.x + 3, B.y + B.h - 10, 1, F.text);
}

function centered(p: Pix, s: string, cx: number, y: number, scale: number, color: string) {
  p.text(s, Math.round(cx - textWidth(s, scale) / 2), y, scale, color);
}
function right(p: Pix, s: string, rx: number, y: number, scale: number, color: string) {
  p.text(s, rx - textWidth(s, scale), y, scale, color);
}

function drawCardFace(p: Pix, x: number, y: number, w: number, rank: number, suit: number) {
  // Rounded corners: inset the corner pixels.
  p.rect(x + 1, y, w - 2, C.h, P.cardEdge);
  p.rect(x, y + 1, w, C.h - 2, P.cardEdge);
  p.rect(x + 1, y + 1, w - 2, C.h - 2, P.cardFace);
  if (w < C.w) return; // mid-flip: plain face
  const color = SUIT_IS_RED[suit] ? P.suitRed : P.suitBlack;
  const r = RANK_TEXT[rank];
  p.text(r, x + 4, y + 4, 2, color);
  p.suit(suit, x + 4, y + 21, 1, color);
  p.suit(suit, x + Math.round((C.w - 27) / 2), y + 44, 3, color);
}

function drawCardBack(p: Pix, x: number, y: number, w: number) {
  p.rect(x + 1, y, w - 2, C.h, P.cardEdge);
  p.rect(x, y + 1, w, C.h - 2, P.cardEdge);
  p.rect(x + 1, y + 1, w - 2, C.h - 2, P.cardFace);
  if (w <= 4) return;
  p.rect(x + 3, y + 3, w - 6, C.h - 6, P.cardBack);
  // Diamond lattice.
  for (let yy = 6; yy < C.h - 6; yy += 6)
    for (let xx = 6 + ((yy / 6) % 2) * 3; xx < w - 6; xx += 6) p.rect(x + xx, y + yy, 2, 2, P.cardBackPattern);
}

export function drawCabinet(p: Pix, v: CabinetView, anim: Anim, now: number) {
  const ctx = p.ctx;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  p.rect(0, 0, SCREEN.w, SCREEN.h, P.field);
  const s = v.state;

  // Pay table.
  const T = LAYOUT.payTable;
  p.rect(T.x - 2, T.y - 2, T.w + 4, T.h + 4, P.frame);
  p.rect(T.x, T.y, T.w, T.h, P.fieldDark);
  const rows = v.lineNames.length;
  const rowH = Math.min(T.maxRowH, Math.floor((T.h - 4) / Math.max(1, rows)));
  const top = T.y + Math.max(2, Math.round((T.h - rows * rowH) / 2) + 1);
  const betCol = s.bet - 1;
  const colX = (b: number) => T.firstColRight + b * T.colW;
  p.rect(colX(betCol) - T.colW + 8, T.y + 1, T.colW - 4, T.h - 2, P.betColumnBg);
  const flash = anim.flashRow(now);
  const hi = s.phase === "dealt" ? s.dealtCategory : flash?.lit ? flash.category : null;
  for (let r = 0; r < rows; r++) {
    const y = top + r * rowH;
    if (hi === r) p.rect(T.x + 1, y - Math.floor((rowH - 7) / 2) - 1, T.w - 2, rowH, P.payHighlightBg);
    const color = hi === r ? P.white : P.payText;
    p.text(v.lineNames[r], T.nameX, y, 1, color);
    for (let b = 0; b < v.payGrid[r].length; b++) right(p, String(v.payGrid[r][b]), colX(b), y, 1, color);
  }

  // Message line.
  const hand = s.hands[0];
  let msg = "";
  let msgColor = P.message;
  if (!hand) msg = `PLAY 1 TO ${v.payGrid[0]?.length ?? 5} CREDITS`;
  else if (s.phase === "dealt") msg = s.dealtCategory !== null ? v.lineNames[s.dealtCategory] : "";
  else if (hand.win > 0 && hand.category !== null) {
    msg = `WINNER! ${v.lineNames[hand.category]}`;
    msgColor = P.winMessage;
  } else msg = "GAME OVER";
  // Hide the result until the drawn cards are face up.
  const settled = [0, 1, 2, 3, 4].every((i) => anim.card(i, now).face && anim.card(i, now).width === 1);
  const lesson = s.phase === "dealt" ? v.trainer.lesson : null;
  if (lesson) centered(p, lesson.message, SCREEN.w / 2, LAYOUT.message.y, 1, F.yellow);
  else if (s.phase === "dealt" || settled) centered(p, msg, SCREEN.w / 2, LAYOUT.message.y, 1, msgColor);
  const mode = v.trainer.mode;

  // Cards.
  for (let i = 0; i < 5; i++) {
    const x = cardX(i, mode);
    if (!hand) {
      drawCardBack(p, x, C.y, C.w);
      continue;
    }
    const look = anim.card(i, now);
    const w = Math.max(2, Math.round(C.w * look.width));
    const cx = x + Math.round((C.w - w) / 2);
    if (look.face) drawCardFace(p, cx, C.y, w, v.rank(hand.cards[i]), v.suit(hand.cards[i]));
    else drawCardBack(p, cx, C.y, w);
    if (s.phase === "dealt" && hand.held[i]) centered(p, "HELD", x + C.w / 2, LAYOUT.held.y, 1, P.held);
    if (lesson?.hint != null && (lesson.hint >> i) & 1) {
      // Lesson hint: a bright frame around each card to hold.
      p.rect(x - 3, C.y - 3, C.w + 6, 2, F.hint);
      p.rect(x - 3, C.y + C.h + 1, C.w + 6, 2, F.hint);
      p.rect(x - 3, C.y - 1, 2, C.h + 2, F.hint);
      p.rect(x + C.w + 1, C.y - 1, 2, C.h + 2, F.hint);
    }
  }
  if (mode === "practice") drawFeedback(p, v.trainer.feedback);

  // Meters.
  const M = LAYOUT.meters;
  const m = anim.meters(now, s);
  p.text("WIN", M.left, M.labelY, 1, P.meterLabel);
  p.text(m.win > 0 ? String(m.win) : "", M.left, M.valueY, 2, P.meterText);
  centered(p, "BET", SCREEN.w / 2, M.labelY, 1, P.meterLabel);
  centered(p, String(s.bet), SCREEN.w / 2, M.valueY, 2, P.meterText);
  right(p, "CREDIT", M.right, M.labelY, 1, P.meterLabel);
  right(p, String(m.credits), M.right, M.valueY, 2, P.meterText);
  centered(p, v.label, SCREEN.w / 2, LAYOUT.gameLabel.y, 1, P.payTextDim);
}
