// Mouse/touch input source: clicking a card holds it (an extra source to
// show the input layer; play is designed for the keyboard).
import { LAYOUT } from "../config/feel";
import { cardX } from "../render/cabinet";
import type { Pix } from "../render/pix";
import type { Mode } from "../config/trainer";
import type { ButtonId, InputSource } from "./actions";

export class PointerSource implements InputSource {
  private handler: ((e: PointerEvent) => void) | null = null;
  enabled: () => boolean = () => true;
  constructor(
    private canvas: HTMLCanvasElement,
    private pix: Pix,
    /** Current trainer mode (the card layout depends on it). */
    private mode: () => Mode = () => "free",
  ) {}

  start(press: (b: ButtonId) => void) {
    this.handler = (e: PointerEvent) => {
      if (!this.enabled()) return;
      const { x, y } = this.pix.toLogical(this.canvas, e.clientX, e.clientY);
      const C = LAYOUT.cards;
      if (y < LAYOUT.held.y || y > C.y + C.h) return;
      for (let i = 0; i < 5; i++) {
        const cx = cardX(i, this.mode());
        if (x >= cx && x <= cx + C.w) {
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
