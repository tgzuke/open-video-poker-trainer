// Draws cards for the cabinet through the current skin. Skins that ask for
// it (`cached`) are pre-rendered once per screen scale to an offscreen
// canvas and blitted from there; during a flip the cached image is
// squeezed, as a real card turning would look. Other skins draw directly.
// The cache is dropped when the scale changes (resize) or the skin does.
import { LAYOUT } from "../config/feel";
import { Pix } from "../render/pix";
import type { BackSkin, FaceSkin } from "./types";

const C = LAYOUT.cards;

export interface Surface {
  width: number;
  height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}

export type SurfaceFactory = (w: number, h: number) => Surface;

export const browserSurface: SurfaceFactory = (w, h) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h) as unknown as Surface;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/** Roughly how much cache memory to allow (bytes of pixels). */
const CACHE_BYTES = 48 * 1024 * 1024;

export class CardRenderer {
  private cache = new Map<string, Surface>();
  private scale = 0;
  /** Cards rendered into the cache so far (for tests and timing). */
  renders = 0;
  private warmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public faces: FaceSkin,
    public backs: BackSkin,
    private surface: SurfaceFactory | null = typeof document === "undefined" && typeof OffscreenCanvas === "undefined" ? null : browserSurface,
  ) {}

  /** Change skins (drops the cache for any part that changed). */
  setSkin(faces: FaceSkin, backs: BackSkin) {
    if (faces !== this.faces || backs !== this.backs) this.clear();
    this.faces = faces;
    this.backs = backs;
  }

  clear() {
    this.cache.clear();
    if (this.warmTimer) clearTimeout(this.warmTimer);
    this.warmTimer = null;
  }

  face(p: Pix, x: number, y: number, w: number, rank: number, suit: number) {
    const f = this.faces;
    if (!f.cached || !this.surface) return f.draw(p, x, y, w, C.h, rank, suit);
    this.blit(p, `f${f.id}:${rank}:${suit}`, x, y, w, (q) => f.draw(q, 0, 0, C.w, C.h, rank, suit));
  }

  back(p: Pix, x: number, y: number, w: number) {
    const b = this.backs;
    if (!b.cached || !this.surface) return b.draw(p, x, y, w, C.h);
    this.blit(p, `b${b.id}`, x, y, w, (q) => b.draw(q, 0, 0, C.w, C.h));
  }

  private capacity(k: number) {
    const bytes = Math.ceil(C.w * k) * Math.ceil(C.h * k) * 4;
    return Math.max(12, Math.floor(CACHE_BYTES / bytes));
  }

  private get(k: number, key: string, paint: (q: Pix) => void): Surface {
    if (k !== this.scale) {
      this.clear();
      this.scale = k;
    }
    let s = this.cache.get(key);
    if (s) {
      // Most recently used goes last.
      this.cache.delete(key);
      this.cache.set(key, s);
      return s;
    }
    s = this.surface!(Math.ceil(C.w * k), Math.ceil(C.h * k));
    const q = new Pix(s.getContext("2d") as CanvasRenderingContext2D);
    q.k = k;
    q.ox = 0;
    q.oy = 0;
    paint(q);
    this.renders++;
    this.cache.set(key, s);
    while (this.cache.size > this.capacity(k)) this.cache.delete(this.cache.keys().next().value!);
    return s;
  }

  private blit(p: Pix, key: string, x: number, y: number, w: number, paint: (q: Pix) => void) {
    const s = this.get(p.k, key, paint);
    const dx = p.devX(x);
    const dy = p.devY(y);
    const dw = Math.max(1, p.devX(x + w) - dx);
    const dh = p.devY(y + C.h) - dy;
    const ctx = p.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s as unknown as CanvasImageSource, 0, 0, Math.round(C.w * p.k), Math.round(C.h * p.k), dx, dy, dw, dh);
  }

  /** Pre-renders every face and the back for this scale in small idle
   *  slices, so the first deal of a card never renders it in the frame.
   *  Each slice is one card, so input is never kept waiting. */
  prewarm(k: number) {
    if (!this.surface || (!this.faces.cached && !this.backs.cached)) return;
    if (this.warmTimer) clearTimeout(this.warmTimer);
    const jobs: (() => void)[] = [];
    if (this.backs.cached) jobs.push(() => this.get(k, `b${this.backs.id}`, (q) => this.backs.draw(q, 0, 0, C.w, C.h)));
    if (this.faces.cached) {
      const f = this.faces;
      const cap = this.capacity(k) - 1;
      let n = 0;
      for (let suit = 0; suit < 4; suit++)
        for (let rank = 2; rank <= 14; rank++) if (n++ < cap) jobs.push(() => this.get(k, `f${f.id}:${rank}:${suit}`, (q) => f.draw(q, 0, 0, C.w, C.h, rank, suit)));
    }
    const step = () => {
      const job = jobs.shift();
      if (!job) {
        this.warmTimer = null;
        return;
      }
      job();
      this.warmTimer = setTimeout(step, 4);
    };
    this.warmTimer = setTimeout(step, 30);
  }
}
