// Default theme cards: a finer pixel grid (half a logical pixel; 128×176
// art pixels on a 64×88 card), shaded suits, procedural court portraits,
// an original Ace of Spades, and procedural backs.
import { ART_BOX, ART_SCALE, FACE_PALETTE } from "../config/skins";
import { LAYOUT } from "../config/feel";
import type { Pix } from "../render/pix";
import { Raster, roundRect, shape } from "./raster";
import { BACKS, backRaster, type BackDesign } from "./art/backs";
import { aceCrestRaster, courtPlan, courtRaster } from "./art/court";
import { ink, rankRaster, suitRaster, suitRing } from "./art/suits";
import type { BackSkin, FaceSkin } from "./types";

const C = LAYOUT.cards;
export const ART_W = C.w * ART_SCALE;
export const ART_H = C.h * ART_SCALE;

/** The art box for court cards and the A♠, in art pixels. */
export function artBox() {
  return {
    x: Math.round(ART_BOX.x * ART_W),
    y: Math.round(ART_BOX.y * ART_H),
    w: Math.round(ART_BOX.w * ART_W),
    h: Math.round(ART_BOX.h * ART_H),
  };
}

/** The large suit on every card (art pixels). */
export const BIG_SUIT = { size: 56, y: 100 };

/** Index position (top-left) and sizes, in art pixels. */
export const INDEX = { x: 7, y: 8, rankH: 24, suitY: 37, suitW: 16 };

/** The card's blank face: edge, warm off-white, a one-tone shadow. */
function blank(): Raster {
  const r = new Raster(ART_W, ART_H);
  r.fill(roundRect(0, 0, ART_W, ART_H, 7), "e");
  const inner = roundRect(1, 1, ART_W - 2, ART_H - 2, 6);
  r.fill(inner, "f");
  r.rim(inner, "f", "s", 2, 2);
  return r;
}

/** Art rows of one card face (rank 2..14, suit 0..3). */
export function faceRows(rank: number, suit: number): string[] {
  const r = blank();
  const k = ink(suit);
  r.stamp(rankRaster(rank, INDEX.rankH, k.base, k.aa), INDEX.x, INDEX.y);
  r.stamp(suitRaster(suit, INDEX.suitW), INDEX.x, INDEX.suitY);
  // Every card keeps the large suit, centred and pushed down; court cards
  // and the A♠ add art in the upper-right corner, opposite the index.
  const size = BIG_SUIT.size;
  const bx = Math.round((ART_W - size) / 2);
  r.stamp(suitRaster(suit, size), bx, BIG_SUIT.y);
  const box = artBox();
  if (rank >= 11 && rank <= 13) {
    r.stamp(courtRaster(courtPlan(rank as 11 | 12 | 13, suit), box.w, box.h), box.x, box.y);
  } else if (rank === 14 && suit === 3) {
    r.stamp(aceCrestRaster(box.w, box.h), box.x, box.y);
    // The large spade itself is decorated: a gold inset line and a blue gem.
    r.fill(suitRing(3, bx + 8, BIG_SUIT.y + 7, size - 16, size - 18, 2.2), "y", "Y");
    const gx = bx + size / 2;
    const gy = BIG_SUIT.y + size * 0.52;
    const gem = shape((x, y) => Math.abs(x - gx) / 5 + Math.abs(y - gy) / 7 <= 1, [gx - 5, gy - 7, gx + 5, gy + 7]);
    r.fill(gem, "b", "B");
    r.rim(gem, "b", "c", -1, -1);
  }
  return r.rows();
}

const faceCache = new Map<number, string[]>();
const backCache = new Map<string, string[]>();

/** Fills the art caches with rows generated elsewhere (the art worker). */
export function primeArt(faces: [number, string[]][], backs: [string, string[]][]) {
  for (const [k, rows] of faces) if (!faceCache.has(k)) faceCache.set(k, rows);
  for (const [k, rows] of backs) if (!backCache.has(k)) backCache.set(k, rows);
}

/** Generates the art in a Web Worker (browser only); resolves with the
 *  worker's time in ms. Until it arrives, a card is generated on demand. */
export function loadArtInWorker(): Promise<number> {
  if (typeof Worker === "undefined") return Promise.resolve(0);
  return new Promise((resolve) => {
    const w = new Worker(new URL("./artWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<{ faces: [number, string[]][]; backs: [string, string[]][]; ms: number }>) => {
      primeArt(ev.data.faces, ev.data.backs);
      w.terminate();
      resolve(ev.data.ms);
    };
    w.onerror = () => resolve(-1);
    w.postMessage(null);
  });
}

/** Cached art rows (generated on first use; the same every time). */
export function faceArt(rank: number, suit: number): string[] {
  const key = rank * 4 + suit;
  let rows = faceCache.get(key);
  if (!rows) {
    rows = faceRows(rank, suit);
    faceCache.set(key, rows);
  }
  return rows;
}

export const DEFAULT_FACES: FaceSkin = {
  id: "default",
  name: "Default (16-bit)",
  cached: true,
  indexColors: (suit) => ({ ink: FACE_PALETTE[ink(suit).base], paper: FACE_PALETTE.f }),
  draw(p: Pix, x: number, y: number, w: number, h: number, rank: number, suit: number) {
    p.paletteBitmap(faceArt(rank, suit), FACE_PALETTE, x, y, w / ART_W, h / ART_H);
  },
};

export function backArt(d: BackDesign): string[] {
  let rows = backCache.get(d.id);
  if (!rows) {
    rows = backRaster(d, ART_W, ART_H).rows();
    backCache.set(d.id, rows);
  }
  return rows;
}

export const DEFAULT_BACKS: BackSkin[] = BACKS.map((d) => ({
  id: d.id,
  name: d.name,
  cached: true,
  draw(p: Pix, x: number, y: number, w: number, h: number) {
    p.paletteBitmap(backArt(d), d.palette, x, y, w / ART_W, h / ART_H);
  },
}));
