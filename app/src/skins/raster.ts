// A tiny deterministic rasterizer for card art. Shapes are drawn onto a
// grid of palette keys (one character per pixel) by supersampling, so edge
// pixels can take an in-between "anti-aliasing" tone, as a pixel artist
// would place by hand. The result is plain rows of palette keys
// (`Pix.paletteBitmap` draws them), independent of the screen size.
//
// Coordinates are continuous art pixels: pixel (i, j) covers
// [i, i+1) × [j, j+1); y grows downward.

export interface Shape {
  inside(x: number, y: number): boolean;
  /** Bounding box [x0, y0, x1, y1] (only these pixels are sampled). */
  box: readonly [number, number, number, number];
}

const BIG = 1e6;

export const shape = (inside: (x: number, y: number) => boolean, box: readonly [number, number, number, number] = [-BIG, -BIG, BIG, BIG]): Shape => ({ inside, box });

export function circle(cx: number, cy: number, r: number): Shape {
  return ellipse(cx, cy, r, r);
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): Shape {
  return shape((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, [cx - rx, cy - ry, cx + rx, cy + ry]);
}

export function rect(x: number, y: number, w: number, h: number): Shape {
  return shape((px, py) => px >= x && px < x + w && py >= y && py < y + h, [x, y, x + w, y + h]);
}

/** Rectangle with rounded corners of radius r. */
export function roundRect(x: number, y: number, w: number, h: number, r: number): Shape {
  return shape((px, py) => {
    if (px < x || px >= x + w || py < y || py >= y + h) return false;
    const cx = Math.min(Math.max(px, x + r), x + w - r);
    const cy = Math.min(Math.max(py, y + r), y + h - r);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  }, [x, y, x + w, y + h]);
}

/** Polygon (even-odd rule). Points as [x, y]. */
export function poly(pts: readonly (readonly [number, number])[]): Shape {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return shape(
    (x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  );
}

/** A thick line segment with round ends (radius r). */
export function capsule(x1: number, y1: number, x2: number, y2: number, r: number): Shape {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1e-9;
  return shape(
    (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      return (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 <= r * r;
    },
    [Math.min(x1, x2) - r, Math.min(y1, y2) - r, Math.max(x1, x2) + r, Math.max(y1, y2) + r],
  );
}

/** A thick stroke along an elliptical arc; angles in degrees (0 = right,
 *  90 = down). */
export function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, r: number): Shape {
  const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 10));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return polyline(pts, r);
}

/** A thick open polyline with round joins. */
export function polyline(pts: readonly (readonly [number, number])[], r: number): Shape {
  const parts: Shape[] = [];
  for (let i = 1; i < pts.length; i++) parts.push(capsule(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r));
  return union(...parts);
}

export function union(...s: Shape[]): Shape {
  return shape(
    (x, y) => s.some((a) => inBox(a, x, y) && a.inside(x, y)),
    [Math.min(...s.map((a) => a.box[0])), Math.min(...s.map((a) => a.box[1])), Math.max(...s.map((a) => a.box[2])), Math.max(...s.map((a) => a.box[3]))],
  );
}

export function diff(a: Shape, ...cut: Shape[]): Shape {
  return shape((x, y) => a.inside(x, y) && !cut.some((c) => inBox(c, x, y) && c.inside(x, y)), a.box);
}

export function intersect(a: Shape, b: Shape): Shape {
  return shape((x, y) => a.inside(x, y) && b.inside(x, y), [Math.max(a.box[0], b.box[0]), Math.max(a.box[1], b.box[1]), Math.min(a.box[2], b.box[2]), Math.min(a.box[3], b.box[3])]);
}

/** A shape defined on the unit square, placed in the box (x, y, w, h). */
export function place(unit: Shape, x: number, y: number, w: number, h: number): Shape {
  return shape((px, py) => unit.inside((px - x) / w, (py - y) / h), [x, y, x + w, y + h]);
}

/** Mirror image (left↔right) about x = cx. */
export function mirrorX(s: Shape, cx: number): Shape {
  return shape((x, y) => s.inside(2 * cx - x, y), [2 * cx - s.box[2], s.box[1], 2 * cx - s.box[0], s.box[3]]);
}

/** The shape turned 180° about (cx, cy). */
export function rotate180(s: Shape, cx: number, cy: number): Shape {
  return shape((x, y) => s.inside(2 * cx - x, 2 * cy - y), [2 * cx - s.box[2], 2 * cy - s.box[3], 2 * cx - s.box[0], 2 * cy - s.box[1]]);
}

export function translate(s: Shape, dx: number, dy: number): Shape {
  return shape((x, y) => s.inside(x - dx, y - dy), [s.box[0] + dx, s.box[1] + dy, s.box[2] + dx, s.box[3] + dy]);
}

function inBox(s: Shape, x: number, y: number) {
  const b = s.box;
  return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
}

/** Grid of palette keys. 0 = transparent. */
export class Raster {
  readonly px: Uint8Array;
  /** Only pixels inside the clip are painted (null = everywhere). */
  clip: Shape | null = null;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Uint8Array(w * h);
  }

  get(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return ".";
    const v = this.px[y * this.w + x];
    return v ? String.fromCharCode(v) : ".";
  }

  set(x: number, y: number, key: string) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (this.clip && !this.clip.inside(x + 0.5, y + 0.5)) return;
    this.px[y * this.w + x] = key === "." ? 0 : key.charCodeAt(0);
  }

  /** Pixel range a shape's box touches. */
  private span(s: Shape): [number, number, number, number] {
    return [Math.max(0, Math.floor(s.box[0])), Math.max(0, Math.floor(s.box[1])), Math.min(this.w - 1, Math.ceil(s.box[2])), Math.min(this.h - 1, Math.ceil(s.box[3]))];
  }

  /** Coverage (0..1) of pixel (i, j) by the shape, from n×n samples. */
  coverage(s: Shape, i: number, j: number, n = 4): number {
    let hit = 0;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (s.inside(i + (a + 0.5) / n, j + (b + 0.5) / n)) hit++;
    return hit / (n * n);
  }

  /** Paints the shape: pixels at least half covered get `key`; pixels
   *  partly covered (≥ `edgeMin`) get `edge`, if given. */
  fill(s: Shape, key: string, edge?: string, edgeMin = 0.2) {
    const [x0, y0, x1, y1] = this.span(s);
    for (let j = y0; j <= y1; j++)
      for (let i = x0; i <= x1; i++) {
        const c = edge ? this.coverage(s, i, j) : s.inside(i + 0.5, j + 0.5) ? 1 : 0;
        if (c >= 0.5) this.set(i, j, key);
        else if (edge && c >= edgeMin && this.get(i, j) !== key) this.set(i, j, edge);
      }
  }

  /** Pixels currently `keys` (any of) inside the shape, whose neighbour at
   *  (dx, dy) is outside it, become `key`: a rim light or shadow. */
  rim(s: Shape, keys: string, key: string, dx: number, dy: number) {
    const [x0, y0, x1, y1] = this.span(s);
    const hits: number[] = [];
    for (let j = y0; j <= y1; j++)
      for (let i = x0; i <= x1; i++)
        if (keys.includes(this.get(i, j)) && s.inside(i + 0.5, j + 0.5) && !s.inside(i + 0.5 + dx, j + 0.5 + dy)) hits.push(i, j);
    for (let k = 0; k < hits.length; k += 2) this.set(hits[k], hits[k + 1], key);
  }

  /** Replaces one key by another wherever the shape covers (pixel centres). */
  recolor(s: Shape, from: string, to: string) {
    const [x0, y0, x1, y1] = this.span(s);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if (this.get(i, j) === from && s.inside(i + 0.5, j + 0.5)) this.set(i, j, to);
  }

  /** Outline: transparent-or-other pixels next to `keys` pixels inside
   *  the box become `key` (4-neighbour). */
  outline(keys: string, key: string, over = ".") {
    const hits: number[] = [];
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) {
        if (!over.includes(this.get(i, j))) continue;
        if ([this.get(i - 1, j), this.get(i + 1, j), this.get(i, j - 1), this.get(i, j + 1)].some((k) => keys.includes(k))) hits.push(i, j);
      }
    for (let k = 0; k < hits.length; k += 2) this.set(hits[k], hits[k + 1], key);
  }

  /** Copies another raster's painted pixels at (x, y). */
  stamp(src: Raster, x: number, y: number) {
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const v = src.px[j * src.w + i];
        if (v) this.set(x + i, y + j, String.fromCharCode(v));
      }
  }

  rows(): string[] {
    const out: string[] = [];
    for (let j = 0; j < this.h; j++) {
      let row = "";
      for (let i = 0; i < this.w; i++) {
        const v = this.px[j * this.w + i];
        row += v ? String.fromCharCode(v) : ".";
      }
      out.push(row);
    }
    return out;
  }
}

/** Deterministic PRNG (mulberry32): same seed, same sequence. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
