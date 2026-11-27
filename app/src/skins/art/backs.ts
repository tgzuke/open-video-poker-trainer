// Default theme: card backs, generated in code. Each design is a function
// of the offset (dx, dy) from the card's centre, evaluated through a
// 180° fold, so every back is exactly symmetric under a half turn, like a
// real deck. A white border margin frames the pattern.
import { Raster, roundRect } from "../raster";

export interface BackDesign {
  id: string;
  name: string;
  palette: Record<string, string>;
  /** Palette key at offset (dx, dy) art pixels from the centre. */
  key(dx: number, dy: number): string;
  /** Inner frame line colour key. */
  frame: string;
}

const frac = (v: number) => v - Math.floor(v);
const near = (v: number) => Math.abs(v - Math.round(v));
/** Deterministic hash of an integer cell → [0, 1). */
function cellHash(i: number, j: number, salt: number): number {
  let h = Math.imul(i * 374761393 + j * 668265263 + salt * 2147483647, 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const PAPER = { e: "#1e1e28", f: "#f6f2e7" };

export const BACKS: BackDesign[] = [
  {
    // The default: the cabinet's red, blue and yellow.
    id: "lattice",
    name: "Diamond lattice",
    frame: "y",
    palette: { ...PAPER, r: "#c81818", R: "#8c0e0e", b: "#1830c8", B: "#0a1a8c", y: "#ffd800", Y: "#b88a00", z: "#fff2a0" },
    key(dx, dy) {
      const d = Math.hypot(dx, dy * 0.85);
      if (d < 20) {
        if (d >= 17) return "y";
        if (d >= 15.5) return "Y";
        const a = Math.atan2(dy, dx);
        const star = 12.5 * (0.42 + 0.58 * Math.pow(Math.abs(Math.cos(4 * a)), 6));
        return d < star ? (d < 4 ? "z" : "y") : "B";
      }
      const s = dx / 15 + dy / 19;
      const t = dx / 15 - dy / 19;
      if (near(s) < 0.06 || near(t) < 0.06) return "y";
      if (near(s) < 0.1 || near(t) < 0.1) return "Y";
      if (Math.abs(frac(s) - 0.5) < 0.12 && Math.abs(frac(t) - 0.5) < 0.12) return "z";
      return (Math.floor(s) + Math.floor(t)) % 2 === 0 ? "r" : "b";
    },
  },
  {
    id: "sunburst",
    name: "Deco sunburst",
    frame: "y",
    palette: { ...PAPER, B: "#101a40", b: "#1d4e89", y: "#e8b84a", Y: "#9a7420", z: "#fff0c0" },
    key(dx, dy) {
      const d = Math.hypot(dx, dy);
      if (d < 9) return d < 5 ? "z" : "y";
      if (d < 11) return "Y";
      if (near(d / 18) < 0.06) return "y";
      const a = Math.atan2(dy, dx);
      const ray = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 28);
      if (near(((a + Math.PI) / (2 * Math.PI)) * 28) < 0.06) return "Y";
      return ray % 2 === 0 ? "b" : "B";
    },
  },
  {
    id: "argyle",
    name: "Argyle",
    frame: "r",
    palette: { ...PAPER, g: "#2e7d4f", G: "#174d30", w: "#f2efe6", r: "#9b1b30" },
    key(dx, dy) {
      const s = dx / 26 + dy / 36;
      const t = dx / 26 - dy / 36;
      // Thin dashed overcheck lines through the diamonds' centres.
      const dash = (v: number) => frac(v * 4) < 0.55;
      if ((near(s + 0.5) < 0.035 && dash(t)) || (near(t + 0.5) < 0.035 && dash(s))) return "w";
      // Small burgundy diamonds where the diamonds meet.
      if (near(s) + near(t) < 0.11) return "r";
      return (Math.floor(s) + Math.floor(t)) % 2 === 0 ? "g" : "G";
    },
  },
  {
    id: "stars",
    name: "Night sky",
    frame: "c",
    palette: { ...PAPER, k: "#0d0b26", K: "#07061a", w: "#ffffff", z: "#fff3b0", c: "#9fc4ff", y: "#ffd84a", b: "#3a2f7a" },
    key(dx, dy) {
      // A ringed planet in the middle.
      const ring = Math.hypot(dx, dy * 3.2);
      const planet = Math.hypot(dx, dy);
      if (planet < 9) return dx + dy < -4 ? "c" : "b";
      if (ring > 13 && ring < 16.5 && Math.abs(dy) < 6) return "y";
      // Stars: one chance per 9-pixel cell.
      const ci = Math.floor(dx / 9);
      const cj = Math.floor(dy / 9);
      const v = cellHash(ci, cj, 3);
      if (v < 0.5) {
        const sx = ci * 9 + 2 + cellHash(ci, cj, 5) * 5;
        const sy = cj * 9 + 2 + cellHash(ci, cj, 7) * 5;
        const ex = Math.abs(dx - sx);
        const ey = Math.abs(dy - sy);
        const big = v < 0.12;
        if (ex < 0.8 && ey < 0.8) return big ? "w" : v < 0.3 ? "z" : "c";
        if (big && ((ex < 0.6 && ey < 3) || (ey < 0.6 && ex < 3))) return "z";
      }
      return Math.hypot(dx / 64, dy / 88) > 0.95 ? "K" : "k";
    },
  },
  {
    id: "knot",
    name: "Interlace",
    frame: "y",
    palette: { ...PAPER, j: "#0f5c46", J: "#0a4031", K: "#062a20", y: "#e0b23c", Y: "#a07a20" },
    key(dx, dy) {
      const s = (dx + dy) / 22;
      const t = (dx - dy) / 22;
      const fa = Math.abs(frac(s) - 0.5);
      const fb = Math.abs(frac(t) - 0.5);
      const inA = fa < 0.21;
      const inB = fb < 0.21;
      const band = (f: number) => (f > 0.16 ? "K" : f > 0.1 ? "y" : "Y");
      if (inA && inB) return (Math.floor(s) + Math.floor(t)) % 2 === 0 ? band(fa) : band(fb);
      if (inA) return band(fa);
      if (inB) return band(fb);
      return near(s * 2) < 0.08 && near(t * 2) < 0.08 ? "J" : "j";
    },
  },
  {
    id: "chips",
    name: "Chip rack",
    frame: "y",
    palette: { ...PAPER, G: "#0f4d2a", r: "#c81818", b: "#1830c8", k: "#22222c", w: "#f4f1e8", y: "#ffd800" },
    key(dx, dy) {
      // Chips on a hex grid, centred on the card.
      const row = Math.round(dy / 21);
      let best = Infinity;
      let cxv = 0;
      let cyv = 0;
      for (const rr of [row - 1, row, row + 1]) {
        const o = rr % 2 !== 0 ? 12 : 0;
        const col = Math.round((dx - o) / 24);
        for (const cc of [col - 1, col, col + 1]) {
          const x = cc * 24 + o;
          const y = rr * 21;
          const d = Math.hypot(dx - x, dy - y);
          if (d < best) {
            best = d;
            cxv = x;
            cyv = y;
          }
        }
      }
      if (best > 10.5) return "G";
      const color = ["r", "b", "k"][(Math.round(cxv / 12) ** 2 + Math.round(cyv / 21) ** 2) % 3];
      if (best > 7.5) {
        const a = Math.atan2(dy - cyv, dx - cxv);
        const notch = near((a / (2 * Math.PI)) * 6) < 0.09;
        return notch ? "w" : color;
      }
      if (best > 6.3) return "w";
      return best < 2 ? "y" : color;
    },
  },
];

export const DEFAULT_BACK = "lattice";

/** A back `w`×`h` art pixels: edge, paper border, pattern panel. */
export function backRaster(design: BackDesign, w: number, h: number): Raster {
  const r = new Raster(w, h);
  r.fill(roundRect(0, 0, w, h, 7), "e");
  r.fill(roundRect(1, 1, w - 2, h - 2, 6), "f");
  const m = 7;
  const panel = roundRect(m, m, w - 2 * m, h - 2 * m, 4);
  for (let j = m; j < h - m; j++)
    for (let i = m; i < w - m; i++) {
      if (!panel.inside(i + 0.5, j + 0.5)) continue;
      let dx = i + 0.5 - w / 2;
      let dy = j + 0.5 - h / 2;
      // 180° fold: the lower half repeats the upper half turned round.
      if (dy > 0 || (dy === 0 && dx > 0)) {
        dx = -dx;
        dy = -dy;
      }
      r.set(i, j, design.key(dx, dy));
    }
  r.outline(Object.keys(design.palette).filter((k) => k !== "e" && k !== "f").join(""), design.frame, "f");
  return r;
}
