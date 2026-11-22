// Pixel drawing layer: everything is laid out on a fixed logical grid
// (SCREEN, 480×270) and drawn as rectangles whose edges are rounded to
// device pixels, so the art is crisp and seam-free at any window size
// ("vector-rendered pixel art", SPEC §6.1).

import { SCREEN } from "../config/feel";
import { ADVANCE, glyph, SUIT_SIZE, SUITS } from "./font";

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
