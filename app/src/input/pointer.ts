// Mouse/touch input source: clicking a card holds it (an extra source to
// show the input layer; play is designed for the keyboard).
import { LAYOUT } from "../config/feel";
import { cardX } from "../render/cabinet";
import type { Pix } from "../render/pix";
import type { ButtonId, InputSource } from "./actions";

export class PointerSource implements InputSource {
  private handler: ((e: PointerEvent) => void) | null = null;
  enabled: () => boolean = () => true;
  constructor(
    private canvas: HTMLCanvasElement,
    private pix: Pix,
  ) {}

  start(press: (b: ButtonId) => void) {
    this.handler = (e: PointerEvent) => {
      if (!this.enabled()) return;
      const r = this.canvas.getBoundingClientRect();
      const dpr = this.canvas.width / r.width;
      const x = ((e.clientX - r.left) * dpr - this.pix.ox) / this.pix.k;
      const y = ((e.clientY - r.top) * dpr - this.pix.oy) / this.pix.k;
      const C = LAYOUT.cards;
      if (y < LAYOUT.held.y || y > C.y + C.h) return;
      for (let i = 0; i < 5; i++) {
        if (x >= cardX(i) && x <= cardX(i) + C.w) {
          press(`hold${i + 1}` as ButtonId);
          return;
        }
      }
    };
    this.canvas.addEventListener("pointerdown", this.handler);
  }
  stop() {
    if (this.handler) this.canvas.removeEventListener("pointerdown", this.handler);
  }
}
