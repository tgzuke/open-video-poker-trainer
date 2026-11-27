// Pixel drawing layer: everything is laid out on a fixed logical grid
// (SCREEN, 480×270) and drawn as rectangles whose edges are rounded to
// device pixels, so the art is crisp and seam-free at any window size
// ("vector-rendered pixel art", SPEC §6.1).

import { SCREEN } from "../config/feel";
import { ADVANCE, glyph, SUIT_SIZE, SUITS } from "./font";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export class Pix {
  k = 1;
  ox = 0;
  oy = 0;
  constructor(public ctx: CanvasRenderingContext2D) {}

  /** Fit the logical screen into a device-pixel area (letterboxed). */
  fit(devW: number, devH: number) {
    this.k = Math.min(devW / SCREEN.w, devH / SCREEN.h);
    this.ox = Math.round((devW - SCREEN.w * this.k) / 2);
    this.oy = Math.round((devH - SCREEN.h * this.k) / 2);
  }

  /** Page (client) coordinates → logical screen coordinates. */
  toLogical(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.width / r.width;
    return { x: ((clientX - r.left) * dpr - this.ox) / this.k, y: ((clientY - r.top) * dpr - this.oy) / this.k };
  }

  private dx(x: number) {
    return Math.round(this.ox + x * this.k);
  }
  private dy(y: number) {
    return Math.round(this.oy + y * this.k);
  }
  /** Device pixel of a logical x / y (as rect() rounds them). */
  devX(x: number) {
    return this.dx(x);
  }
  devY(y: number) {
    return this.dy(y);
  }

  rect(x: number, y: number, w: number, h: number, color: string) {
    const x0 = this.dx(x);
    const y0 = this.dy(y);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x0, y0, this.dx(x + w) - x0, this.dy(y + h) - y0);
  }

  /** Draws a bitmap; runs of lit pixels in a row are merged into one rect. */
  bitmap(bits: boolean[][], x: number, y: number, scale: number, color: string) {
    for (let r = 0; r < bits.length; r++) {
      const row = bits[r];
      let c = 0;
      while (c < row.length) {
        if (!row[c]) {
          c++;
          continue;
        }
        const start = c;
        while (c < row.length && row[c]) c++;
        this.rect(x + start * scale, y + r * scale, (c - start) * scale, scale, color);
      }
    }
  }

  /** Draws a palette-indexed bitmap: each row is a string of palette keys
   *  (one character per pixel; "." or " " is transparent). Runs of the same
   *  key in a row are merged into one rect. `sx`/`sy` are the logical size
   *  of one bitmap pixel (e.g. 0.5 for art on a half-pixel grid). */
  paletteBitmap(rows: readonly string[], palette: Readonly<Record<string, string>>, x: number, y: number, sx: number, sy = sx) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      let c = 0;
      while (c < row.length) {
        const key = row[c];
        if (key === "." || key === " ") {
          c++;
          continue;
        }
        const start = c;
        while (c < row.length && row[c] === key) c++;
        const color = palette[key];
        if (color) this.rect(x + start * sx, y + r * sy, (c - start) * sx, sy, color);
      }
    }
  }

  text(s: string, x: number, y: number, scale: number, color: string) {
    for (let i = 0; i < s.length; i++) this.bitmap(glyph(s[i]), x + i * ADVANCE * scale, y, scale, color);
  }

  suit(suit: number, x: number, y: number, scale: number, color: string) {
    this.bitmap(SUITS[suit], x, y, scale, color);
  }

  static suitSize(scale: number) {
    return SUIT_SIZE * scale;
  }
}
