// Strategy view: the rules of the trainer's strategy, drawn on the cabinet
// screen in the game's own style. Opened from the strategy tag (Practice
// and Lesson) or its key; the tabs switch the strategy level.
import { LAYOUT, PALETTE as P, SCREEN } from "../config/feel";
import { FEEDBACK as F } from "../config/trainer";
import { LEVELS, type Level } from "../engine/protocol";
import { ruleDisplay } from "../trainer/ruleText";
import { textWidth, wrap } from "./font";
import { inRect, type Pix, type Rect } from "./pix";

export { inRect, type Rect };

/** What the view shows. `rules` null = loading; empty = no strategy. */
export interface StrategyContent {
  title: string;
  tier: Level;
  rules: string[] | null;
  /** e.g. "RETURN 99.5421%, 0.0019 CREDITS/HAND BELOW OPTIMAL". */
  summary: string;
  closeKey: string;
}

const V = LAYOUT.strategyView;
export const LEVEL_TAGS: Record<Level, string> = { beginner: "BEGINNER", intermediate: "INTERMEDIATE", expert: "EXPERT", custom: "MY STRATEGY" };
const LIST_TOP = V.y + 44;
const LIST_BOTTOM = V.y + V.h - 18;
export const VISIBLE_ROWS = Math.floor((LIST_BOTTOM - LIST_TOP) / V.row);
const TEXT_X = V.x + 26;
const TEXT_CHARS = Math.floor((V.x + V.w - 10 - TEXT_X) / 6);

export function tabRect(i: number): Rect {
  const w = V.tabW;
  const total = LEVELS.length * w + (LEVELS.length - 1) * 6;
  return { x: Math.round((SCREEN.w - total) / 2) + i * (w + 6), y: V.y + 18, w, h: 13 };
}
export const CLOSE_RECT: Rect = { x: V.x + V.w - 50, y: V.y + V.h - 15, w: 44, h: 12 };

/** Rule list as display rows: [number label or "", text]. */
export function strategyRows(rules: string[]): [string, string][] {
  const rows: [string, string][] = [];
  rules.forEach((r, i) => {
    wrap(ruleDisplay(r).toUpperCase(), TEXT_CHARS).forEach((line, j) => rows.push([j === 0 ? `${i + 1}.` : "", line]));
  });
  return rows;
}

export function maxScroll(rules: string[] | null): number {
  return rules ? Math.max(0, strategyRows(rules).length - VISIBLE_ROWS) : 0;
}

function box(p: Pix, r: Rect, fill: string, frame: string) {
  p.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, frame);
  p.rect(r.x, r.y, r.w, r.h, fill);
}
function centeredIn(p: Pix, s: string, r: Rect, color: string) {
  p.text(s, Math.round(r.x + (r.w - textWidth(s)) / 2), r.y + Math.round((r.h - 7) / 2), 1, color);
}

export function drawStrategyView(p: Pix, c: StrategyContent, scroll: number) {
  p.rect(V.x - 2, V.y - 2, V.w + 4, V.h + 4, P.frame);
  p.rect(V.x, V.y, V.w, V.h, P.fieldDark);
  p.text(c.title, V.x + 8, V.y + 6, 1, P.payText);
  box(p, CLOSE_RECT, P.betColumnBg, P.frame);
  centeredIn(p, "CLOSE", CLOSE_RECT, P.white);

  LEVELS.forEach((t, i) => {
    const r = tabRect(i);
    const on = t === c.tier;
    box(p, r, on ? P.payHighlightBg : P.fieldDark, on ? P.white : P.frame);
    centeredIn(p, LEVEL_TAGS[t], r, on ? P.white : P.payText);
  });
  if (c.summary) p.text(c.summary, Math.round((SCREEN.w - textWidth(c.summary)) / 2), V.y + 35, 1, F.dim);

  if (c.rules === null) {
    p.text("LOADING...", TEXT_X, LIST_TOP, 1, F.dim);
  } else if (c.rules.length === 0) {
    p.text(c.tier === "custom" ? "NO STRATEGY OF YOUR OWN FOR THIS PAY TABLE YET: MAKE ONE IN MENU > STRATEGY EDITOR." : "NO PRESET STRATEGY FOR THIS PAY TABLE.", TEXT_X, LIST_TOP, 1, F.dim);
  } else {
    const rows = strategyRows(c.rules);
    const top = Math.min(scroll, Math.max(0, rows.length - VISIBLE_ROWS));
    for (let k = 0; k < VISIBLE_ROWS && top + k < rows.length; k++) {
      const [num, text] = rows[top + k];
      const y = LIST_TOP + k * V.row;
      if (num) p.text(num, TEXT_X - 4 - textWidth(num), y, 1, P.payText);
      p.text(text, TEXT_X, y, 1, P.white);
    }
    if (rows.length > VISIBLE_ROWS) {
      // Scroll bar.
      const trackH = LIST_BOTTOM - LIST_TOP - 2;
      const barH = Math.max(8, Math.round((trackH * VISIBLE_ROWS) / rows.length));
      const barY = LIST_TOP + Math.round(((trackH - barH) * top) / (rows.length - VISIBLE_ROWS));
      p.rect(V.x + V.w - 6, LIST_TOP, 2, trackH, P.betColumnBg);
      p.rect(V.x + V.w - 7, barY, 4, barH, P.payText);
    }
  }
  const help = `LEFT/RIGHT: LEVEL   UP/DOWN: SCROLL   ${c.closeKey} OR ESC: CLOSE`;
  p.text(help, V.x + 8, V.y + V.h - 12, 1, F.dim);
}

/** The on-screen strategy tag (bottom left) and its click area. */
export function strategyTagRect(label: string): Rect {
  const T = LAYOUT.strategyTag;
  return { x: T.x, y: T.y, w: textWidth(label) + 6, h: 11 };
}

export function drawStrategyTag(p: Pix, label: string) {
  const r = strategyTagRect(label);
  box(p, r, P.fieldDark, P.frame);
  p.text(label, r.x + 3, r.y + 2, 1, P.payText);
}
