// Default theme: suit symbols and rank glyphs at the finer art resolution,
// built from simple shapes (our own drawings) and rasterized with
// in-between edge tones.
import { Raster, arc, capsule, circle, diff, place, poly, shape, union, type Shape } from "../raster";

/** Suit shapes on the unit square (0 clubs, 1 diamonds, 2 hearts, 3 spades). */
export const SUIT_SHAPES: Shape[] = [
  // clubs: three leaves and a flared stem
  union(
    circle(0.5, 0.27, 0.215),
    circle(0.265, 0.555, 0.215),
    circle(0.735, 0.555, 0.215),
    circle(0.5, 0.5, 0.12),
    poly([
      [0.5, 0.52],
      [0.6, 0.86],
      [0.74, 0.99],
      [0.26, 0.99],
      [0.4, 0.86],
    ]),
  ),
  // diamonds: a rhombus with slightly drawn-in sides
  shape((x, y) => {
    const dx = Math.abs(x - 0.5) / 0.4;
    const dy = Math.abs(y - 0.5) / 0.5;
    return Math.pow(dx, 0.92) + Math.pow(dy, 0.92) <= 1;
  }, [0, 0, 1, 1]),
  // hearts: two lobes and a point
  union(
    circle(0.285, 0.31, 0.245),
    circle(0.715, 0.31, 0.245),
    poly([
      [0.06, 0.4],
      [0.94, 0.4],
      [0.5, 0.96],
    ]),
    shape((x, y) => y > 0.3 && y < 0.5 && x > 0.2 && x < 0.8),
  ),
  // spades: an upturned heart with a flared stem
  union(
    circle(0.275, 0.6, 0.225),
    circle(0.725, 0.6, 0.225),
    poly([
      [0.5, 0.02],
      [0.06, 0.56],
      [0.94, 0.56],
    ]),
    shape((x, y) => y > 0.5 && y < 0.66 && x > 0.2 && x < 0.8),
    poly([
      [0.5, 0.62],
      [0.6, 0.88],
      [0.74, 0.99],
      [0.26, 0.99],
      [0.4, 0.88],
    ]),
  ),
];

export const RED_INK = { base: "r", aa: "x", light: "l", dark: "R" };
export const BLACK_INK = { base: "k", aa: "X", light: "g", dark: "K" };
export const ink = (suit: number) => (suit === 1 || suit === 2 ? RED_INK : BLACK_INK);

/** A suit symbol `w`×`h` art pixels; shaded when large enough. */
export function suitRaster(suit: number, w: number, h = w): Raster {
  const r = new Raster(w, h);
  const s = place(SUIT_SHAPES[suit], 0, 0, w, h);
  const k = ink(suit);
  r.fill(s, k.base, k.aa);
  if (w >= 24) {
    const o = Math.max(1, Math.round(w * 0.05));
    r.rim(s, k.base, k.dark, o, o); // shadow, lower right
    r.rim(s, k.base, k.light, -o * 1.5, -o * 1.5); // highlight, upper left
  }
  return r;
}

// Rank glyphs: strokes on a 6×10 box (the "10" is 9 wide), drawn bold.
type Stroke = Shape;
const W = 6;
const seg = (x1: number, y1: number, x2: number, y2: number, t: number): Stroke => capsule(x1, y1, x2, y2, t);
const ring = (cx: number, cy: number, rx: number, ry: number, t: number) => arc(cx, cy, rx, ry, 0, 360, t);

function glyphStrokes(rank: number, t: number): { s: Shape; w: number } {
  switch (rank) {
    case 14:
      return { s: union(seg(0.5, 9.6, 3, 0.4, t), seg(3, 0.4, 5.5, 9.6, t), seg(1.5, 6.4, 4.5, 6.4, t * 0.9)), w: W };
    case 13:
      return { s: union(seg(0.9, 0.4, 0.9, 9.6, t), seg(5.3, 0.4, 1.0, 5.6, t), seg(2.3, 4.3, 5.5, 9.6, t)), w: W };
    case 12:
      return { s: union(ring(3, 4.9, 2.35, 4.4, t), seg(3.5, 7.2, 5.7, 9.9, t)), w: W };
    case 11:
      return { s: union(seg(2.6, 0.4, 5.6, 0.4, t * 0.9), seg(4.6, 0.4, 4.6, 6.8, t), arc(2.75, 6.9, 1.85, 2.6, 0, 180, t)), w: W };
    case 10:
      return { s: union(seg(1.5, 0.6, 1.5, 9.6, t), seg(0.2, 1.9, 1.5, 0.6, t * 0.9), ring(6.1, 5, 2.1, 4.5, t)), w: 9 };
    case 9:
      return { s: union(ring(3, 3.3, 2.35, 2.85, t), arc(3, 3.6, 2.35, 5.9, 0, 115, t)), w: W };
    case 8:
      return { s: union(ring(3, 2.65, 2.0, 2.2, t), ring(3, 7.2, 2.45, 2.4, t)), w: W };
    case 7:
      return { s: union(seg(0.4, 0.5, 5.6, 0.5, t), seg(5.6, 0.5, 2.1, 9.6, t)), w: W };
    case 6:
      return { s: union(ring(3, 6.7, 2.35, 2.85, t), arc(3, 6.4, 2.35, 5.9, 180, 295, t)), w: W };
    case 5:
      return { s: union(seg(5.4, 0.5, 1.2, 0.5, t), seg(1.2, 0.5, 0.9, 4.6, t), arc(2.8, 6.6, 2.6, 2.95, -150, 150, t)), w: W };
    case 4:
      return { s: union(seg(4.3, 0.4, 4.3, 9.6, t), seg(4.3, 0.4, 0.4, 7.0, t), seg(0.4, 7.0, 5.8, 7.0, t)), w: W };
    case 3:
      return { s: union(arc(3, 2.7, 2.3, 2.3, -165, 90, t), arc(3, 7.2, 2.55, 2.45, -90, 165, t)), w: W };
    default: // 2
      return { s: union(arc(3, 3.0, 2.45, 2.6, -170, 25, t), seg(5.1, 4.2, 0.6, 9.5, t), seg(0.6, 9.5, 5.7, 9.5, t)), w: W };
  }
}

/** A rank glyph `h` art pixels tall in the given ink. */
export function rankRaster(rank: number, h: number, key: string, aa: string): Raster {
  const unit = h / 10.6;
  const { s, w } = glyphStrokes(rank, 0.72);
  const pw = Math.ceil((w + 0.6) * unit);
  const r = new Raster(pw, Math.ceil(h));
  const placed = shape((x, y) => s.inside(x / unit - 0.3, y / unit - 0.3), [0, 0, pw, h]);
  r.fill(placed, key, aa);
  return r;
}

/** A filled spade-like ornament: the suit shape minus an inset copy. */
export function suitRing(suit: number, x: number, y: number, w: number, h: number, inset: number): Shape {
  const outer = place(SUIT_SHAPES[suit], x, y, w, h);
  const inner = place(SUIT_SHAPES[suit], x + inset, y + inset * 1.1, w - 2 * inset, h - 2 * inset * 1.1);
  return diff(outer, inner);
}
