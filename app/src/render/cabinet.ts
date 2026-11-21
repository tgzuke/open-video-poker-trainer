// Draws the whole cabinet screen from the game state and the animation.
import { LAYOUT, PALETTE as P, SCREEN } from "../config/feel";
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
}

const C = LAYOUT.cards;

export function cardX(i: number): number {
  const total = 5 * C.w + 4 * C.gap;
  return (SCREEN.w - total) / 2 + i * (C.w + C.gap);
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
  if (s.phase === "dealt" || settled) centered(p, msg, SCREEN.w / 2, LAYOUT.message.y, 1, msgColor);

  // Cards.
  for (let i = 0; i < 5; i++) {
    const x = cardX(i);
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
  }

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
