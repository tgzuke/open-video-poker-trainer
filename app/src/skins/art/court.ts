// Default theme: court card portraits (J, Q, K), generated in code from
// composable parts: hair, robe, collar, face, crown or cap, and a held
// object. Loosely after the old English-pattern court cards (crowned,
// bearded kings with a sword or axe, queens with a flower, capped jacks
// with a halberd or leaf, a few in profile), but these are our own
// drawings. Per rank and suit, a seeded generator picks colours and the
// robe pattern, so every card is distinct and always the same.
import { Raster, arc, capsule, circle, diff, ellipse, intersect, poly, polyline, rect, rng, roundRect, shape, union, type Shape } from "../raster";
import { suitRaster } from "./suits";

/** Darker and lighter tones of each base colour key. */
const TONES: Record<string, [string, string]> = {
  r: ["R", "l"],
  b: ["B", "c"],
  y: ["Y", "z"],
  k: ["K", "g"],
  w: ["v", "w"],
  j: ["J", "j"],
  h: ["H", "a"],
  a: ["h", "y"],
  o: ["V", "O"],
};
const dark = (k: string) => TONES[k]?.[0] ?? k;
const light = (k: string) => TONES[k]?.[1] ?? k;

/** Fill with a shadow on the right and a light on the left. */
function shaded(r: Raster, s: Shape, key: string, depth = 2) {
  r.fill(s, key);
  r.rim(s, key, dark(key), depth, 0);
  r.rim(s, key, light(key), -depth * 0.75, -depth * 0.5);
}

type Pattern = "stripes" | "diamonds" | "dots" | "checks" | "chevrons";
const PATTERNS: Pattern[] = ["stripes", "diamonds", "dots", "checks", "chevrons"];

function pattern(r: Raster, area: Shape, kind: Pattern, base: string, ink: string, x0: number, y0: number) {
  r.fill(area, base);
  const on = (f: (x: number, y: number) => boolean) => r.fill(intersect(area, shape((x, y) => f(x - x0, y - y0))), ink);
  switch (kind) {
    case "stripes":
      on((_, y) => ((y % 9) + 9) % 9 < 2.2);
      break;
    case "diamonds":
      on((x, y) => {
        const s = (x + y) / 9;
        const t = (x - y) / 9;
        const f = (v: number) => Math.abs(v - Math.round(v));
        return f(s) < 0.13 || f(t) < 0.13;
      });
      break;
    case "dots":
      on((x, y) => {
        const gx = ((x % 7) + 7) % 7;
        const gy = (((y + (Math.floor(x / 7) % 2) * 3.5) % 7) + 7) % 7;
        return (gx - 3.5) ** 2 + (gy - 3.5) ** 2 < 2.6;
      });
      break;
    case "checks":
      on((x, y) => (Math.floor(x / 5) + Math.floor(y / 5)) % 2 === 0);
      break;
    case "chevrons":
      on((x, y) => {
        const v = (((y + Math.abs(x) * 0.8) % 10) + 10) % 10;
        return v < 2.6;
      });
      break;
  }
}

/** What a court card looks like (decided from rank, suit and the seed). */
export interface CourtPlan {
  rank: 11 | 12 | 13;
  suit: number;
  profile: boolean;
  robe: string;
  panel: string;
  ink: string;
  sleeve: string;
  hair: string;
  pattern: Pattern;
  held: "sword" | "swordBehind" | "axe" | "orb" | "flower" | "halberd" | "leaf" | "arrow";
  gems: string[];
  petals: string;
  plume: string;
}

export function courtPlan(rank: 11 | 12 | 13, suit: number, seed = 0): CourtPlan {
  const rand = rng(rank * 1009 + suit * 101 + seed * 7919 + 17);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length) % xs.length];
  // Robes in the cabinet's red and blue, the panel in another colour,
  // trimmed in gold; hearts and diamonds lean red, clubs and spades blue.
  const robe = suit === 1 || suit === 2 ? pick(["r", "r", "b"]) : pick(["b", "b", "r"]);
  const panel = pick(["y", "k", robe === "r" ? "b" : "r"]);
  const ink = pick(["w", "y", "k", "r", "b"].filter((k) => k !== panel));
  const sleeve = pick(["y", panel, robe === "r" ? "b" : "r"].filter((k) => k !== robe));
  const hair = rank === 13 ? pick(["o", "h", "a", "k"]) : pick(["h", "a", "y", "k", "H"]);
  // Traditional quirks: the king of hearts' sword behind his head, the king
  // of diamonds with an axe and in profile, one-eyed jacks of spades and
  // hearts, the jack of hearts with a leaf.
  const held: CourtPlan["held"] =
    rank === 13 ? (["orb", "axe", "swordBehind", "sword"] as const)[suit] : rank === 12 ? "flower" : (["arrow", "halberd", "leaf", "halberd"] as const)[suit];
  const profile = (rank === 13 && suit === 1) || (rank === 11 && (suit === 2 || suit === 3));
  return {
    rank,
    suit,
    profile,
    robe,
    panel,
    ink,
    sleeve,
    hair,
    pattern: pick(PATTERNS),
    held,
    gems: [pick(["r", "b", "j"]), pick(["b", "r", "w"]), pick(["j", "r", "b"])],
    petals: pick(["r", "b", "y", "l", "c"]),
    plume: pick(["w", "c", "l", "y"]),
  };
}

/** Draws the portrait into a `w`×`h` raster (the art box). */
export function courtRaster(plan: CourtPlan, w: number, h: number): Raster {
  const r = new Raster(w, h);
  // Work on a 77×162 design grid, scaled to the box.
  const sx = w / 77;
  const sy = h / 162;
  const S = (s: Shape): Shape => shape((x, y) => s.inside(x / sx, y / sy), [s.box[0] * sx, s.box[1] * sy, s.box[2] * sx, s.box[3] * sy]);
  const fill = (s: Shape, k: string, aa?: string) => r.fill(S(s), k, aa);
  const shade = (s: Shape, k: string, d = 2) => shaded(r, S(s), k, d);
  const W = 77;
  const H = 162;
  const cx = 38.5;
  const p = plan;
  const king = p.rank === 13;
  const queen = p.rank === 12;
  const face = p.profile ? -1 : 0; // profile faces left

  // Box: background and frame.
  const box = roundRect(0, 0, W, H, 4);
  fill(box, "q");
  fill(roundRect(1, 1, W - 2, H - 2, 3), "p");
  r.clip = S(roundRect(1, 1, W - 2, H - 2, 3));
  // A small suit pip by the head, as on old court cards.
  const pip = suitRaster(p.suit, Math.round(13 * sx), Math.round(13 * sx));
  r.stamp(pip, Math.round((p.held === "sword" || p.held === "axe" || p.held === "orb" ? 5 : W - 18) * sx), Math.round(5 * sy));

  const handR = { x: cx + 22, y: 112 };
  const handL = { x: cx - 22, y: 104 };

  // Behind the figure.
  if (p.held === "halberd") {
    fill(capsule(handL.x, H + 4, handL.x, 6, 1.4), "h");
    const blade = poly([
      [handL.x, 14],
      [handL.x - 12, 10],
      [handL.x - 13, 24],
      [handL.x, 30],
    ]);
    shade(blade, "v", 1.5);
    fill(capsule(handL.x, 14, handL.x, 1, 1.1), "v");
    fill(poly([
      [handL.x, 20],
      [handL.x + 7, 17],
      [handL.x + 1, 25],
    ]), "V");
  }
  if (p.held === "axe") {
    fill(capsule(handR.x + 2, 122, handR.x + 2, 18, 1.5), "h");
    const head = diff(ellipse(handR.x + 9, 30, 9, 13), ellipse(handR.x + 16, 30, 7, 12));
    shade(head, "v", 1.5);
  }
  if (p.held === "sword") {
    fill(capsule(handR.x + 2, 106, handR.x + 2, 6, 2.2), "v");
    fill(capsule(handR.x + 2.6, 104, handR.x + 2.6, 9, 0.8), "V");
  }

  // Hair, behind the head and shoulders.
  const hairBack = king
    ? ellipse(cx - face * 2, 47, 16, 19)
    : queen
      ? union(ellipse(cx, 45, 16.5, 17), poly([
          [cx - 16.5, 46],
          [cx + 16.5, 46],
          [cx + 20, 80],
          [cx - 20, 80],
        ]))
      : ellipse(cx - face * 5, 47, 15, 13.5);
  shade(hairBack, p.hair, 1.5);

  // Robe and arms.
  const robe = union(ellipse(cx, 80, 33, 16), poly([
    [cx - 33, 80],
    [cx + 33, 80],
    [W + 6, H + 4],
    [-6, H + 4],
  ]));
  shade(robe, p.robe, 2.5);
  const panel = poly([
    [cx - 9, 66],
    [cx + 9, 66],
    [cx + 17, H + 4],
    [cx - 17, H + 4],
  ]);
  pattern(r, S(panel), p.pattern, p.panel, p.ink, cx * sx, 70 * sy);
  fill(polyline([
    [cx - 9, 66],
    [cx - 17, H + 4],
  ], 1.1), "y");
  fill(polyline([
    [cx + 9, 66],
    [cx + 17, H + 4],
  ], 1.1), "y");
  // A belt.
  fill(rect(cx - 30, 124, 60, 4), "Y");
  fill(rect(cx - 30, 124, 60, 2), "y");
  fill(roundRect(cx - 4, 122.5, 8, 7, 1.5), "z");
  // The arm that holds the object.
  const holdRight = p.held === "sword" || p.held === "axe" || p.held === "orb";
  const hand = holdRight ? handR : handL;
  const sleeve = ellipse(hand.x + (holdRight ? -4 : 4), hand.y - 16, 8, 19);
  shade(sleeve, p.sleeve, 2);
  fill(diff(ellipse(hand.x + (holdRight ? -2 : 2), hand.y - 3, 7.5, 3.5), ellipse(hand.x + (holdRight ? -2 : 2), hand.y - 4.5, 6, 2.5)), "y");

  // Collar.
  if (king) {
    const ermine = diff(ellipse(cx, 67, 21, 9.5), ellipse(cx, 62, 9, 6));
    shade(ermine, "w", 1.5);
    for (const [ex, ey] of [
      [cx - 15, 67],
      [cx - 8, 71],
      [cx, 72.5],
      [cx + 8, 71],
      [cx + 15, 67],
    ] as const)
      fill(union(rect(ex - 0.5, ey - 1.5, 1.2, 3), rect(ex - 1.5, ey + 0.5, 3, 1)), "k");
  } else if (queen) {
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * (i / 10);
      const c = circle(cx - Math.cos(a) * 15, 63 + Math.sin(a) * 6, 3.4);
      fill(c, "w", "v");
      r.rim(S(c), "w", "v", 1, 1);
    }
  } else {
    const col = poly([
      [cx - 13, 61],
      [cx + 13, 61],
      [cx, 74],
    ]);
    shade(col, "y", 1.5);
    fill(capsule(cx - 6, 62, cx + 6, 62, 0.8), "Y");
  }

  // The king of hearts' sword: over the shoulder, behind the head.
  if (p.held === "swordBehind") {
    fill(capsule(cx - 22, 92, cx + 22, 4, 2), "v", "V");
    fill(capsule(cx - 21, 90, cx + 21, 6, 0.6), "V");
    fill(capsule(cx - 28.5, 89, cx - 18.5, 96.5, 1.6), "y", "Y");
  }

  // Neck and head.
  fill(rect(cx - 5, 53, 10, 10), "n");
  fill(rect(cx + 1.5, 53, 3.5, 10), "N");
  const head = p.profile
    ? union(ellipse(cx + 1, 44, 12, 15), poly([
        [cx - 9, 38.5],
        [cx - 15.5, 46.5],
        [cx - 10, 48.5],
      ]))
    : ellipse(cx, 44, 12.5, 15);
  fill(head, "n", "N");
  r.rim(S(head), "n", "N", 1.6, 0);

  // Face.
  if (p.profile) {
    fill(rect(cx - 8, 40.5, 3, 2), "w");
    fill(rect(cx - 8, 40.5, 1.5, 2), "k");
    fill(capsule(cx - 9, 37.6, cx - 4.5, 37, 0.65), "H");
    fill(capsule(cx - 10.2, 52, cx - 7, 52.4, 0.7), "R");
    fill(ellipse(cx + 5, 44, 2.4, 3.6), "N");
    fill(ellipse(cx + 5, 44, 1.2, 2.2), "n");
    fill(circle(cx - 5, 48.5, 1.5), "m");
  } else {
    for (const sx2 of [-1, 1]) {
      const ex = cx + sx2 * 5.2;
      fill(rect(ex - 1.5, 41, 3, 2), "w");
      fill(rect(ex - (sx2 < 0 ? 0 : 1.5), 41, 1.5, 2), "k");
      fill(capsule(ex - 2.5, 38.3, ex + 2.5, 38.3 - (queen ? 0.6 : 0), 0.6), "H");
      if (!king) fill(circle(cx + sx2 * 7.2, 48.5, 1.5), "m");
    }
    fill(capsule(cx + 0.6, 43.5, cx + 1.6, 48, 0.6), "N");
    fill(capsule(cx - 0.6, 48.6, cx + 2, 48.6, 0.5), "N");
    fill(capsule(cx - 2.8, 52.3, cx + 2.8, 52.3, queen ? 0.9 : 0.7), queen ? "r" : "R");
  }
  // Fringe over the forehead.
  if (!king) fill(intersect(ellipse(cx - face * 2, 34, 13, 7), rect(cx - 16, 26, 32, 10)), p.hair);

  // King's beard and moustache.
  if (king) {
    const beard = p.profile
      ? intersect(ellipse(cx - 1, 55, 10.5, 11), rect(cx - 13, 51, 24, 16))
      : intersect(ellipse(cx, 56, 12, 11.5), rect(cx - 13, 51.5, 26, 17));
    shade(beard, p.hair, 1.5);
    const tache = p.profile ? ellipse(cx - 6, 50.5, 4.5, 1.8) : union(ellipse(cx - 4, 50.5, 4.5, 1.8), ellipse(cx + 4, 50.5, 4.5, 1.8));
    fill(tache, dark(p.hair));
    fill(capsule(cx - (p.profile ? 8.5 : 2), 53.5, cx + (p.profile ? -5.5 : 2), 53.5, 0.6), "R");
  }

  // Headwear.
  if (king || queen) {
    const top = king ? 10 : 16;
    const band = king ? rect(cx - 13, 24, 26, 6) : rect(cx - 11, 25, 22, 4.5);
    const cap = ellipse(cx, king ? 23 : 25, king ? 11 : 9, king ? 9.5 : 6);
    fill(cap, p.robe === "r" ? "b" : "r");
    const peaks = king ? [-12, -6, 0, 6, 12] : [-9, -3, 3, 9];
    const pts = peaks.map((dx) => poly([
      [cx + dx - 3.4, king ? 24.5 : 25.5],
      [cx + dx + 3.4, king ? 24.5 : 25.5],
      [cx + dx, top + (dx === 0 ? -2 : Math.abs(dx) > 10 ? 3 : 1)],
    ]));
    shade(union(band, ...pts), "y", 1.2);
    for (const dx of peaks) fill(circle(cx + dx, top + (dx === 0 ? -2.5 : Math.abs(dx) > 10 ? 2.5 : 0.5), 1.5), "z", "Y");
    const gemX = king ? [-7, 0, 7] : [-5, 5];
    gemX.forEach((dx, i) => fill(ellipse(cx + dx, king ? 27 : 27.2, 1.8, 1.6), p.gems[i % p.gems.length], dark(p.gems[i % p.gems.length])));
    fill(rect(cx - (king ? 13 : 11), king ? 29 : 28.5, king ? 26 : 22, 1), "Y");
  } else {
    // Jack's cap with a plume.
    const off = p.profile ? -2 : 2;
    const cap = ellipse(cx + off, 27, 15, 6.5);
    shade(cap, p.sleeve === "y" ? p.panel === "k" ? "b" : p.panel : p.sleeve, 1.5);
    fill(rect(cx - 12 + off * 0.5, 28.5, 24, 3), "y");
    fill(rect(cx - 12 + off * 0.5, 31, 24, 0.8), "Y");
    const plume = arc(cx + 11 - off * 2, 28, 14, 20, -170, -95, 1.8);
    fill(plume, p.plume, dark(p.plume));
    fill(arc(cx + 11 - off * 2, 28, 14, 20, -168, -100, 0.5), dark(p.plume));
  }

  // The held object, in front.
  switch (p.held) {
    case "sword":
    case "swordBehind": {
      const h = p.held === "sword" ? { x: handR.x + 2, y: handR.y - 6 } : { x: cx - 25.5, y: 96 };
      if (p.held === "sword") {
        fill(capsule(h.x - 8, h.y, h.x + 8, h.y, 1.6), "y", "Y");
        fill(capsule(h.x, h.y + 2, h.x, h.y + 10, 1.5), "h");
        fill(circle(h.x, h.y + 12, 2.3), "y", "Y");
      }
      fill(circle(h.x - 0.5, h.y + 5, 4.2), "n", "N");
      break;
    }
    case "axe":
      fill(circle(handR.x + 1.5, handR.y - 4, 4.2), "n", "N");
      break;
    case "orb": {
      const o = { x: handR.x - 1, y: handR.y - 13 };
      const ball = circle(o.x, o.y, 6.3);
      shade(ball, "y", 1.5);
      fill(rect(o.x - 6.3, o.y - 0.8, 12.6, 1.6), "Y");
      fill(capsule(o.x, o.y - 6, o.x, o.y - 11, 0.8), "y");
      fill(capsule(o.x - 2.2, o.y - 9, o.x + 2.2, o.y - 9, 0.8), "y");
      fill(circle(handR.x - 1, handR.y - 4, 4.2), "n", "N");
      break;
    }
    case "flower": {
      const b = { x: handL.x + 1, y: 78 };
      fill(polyline([
        [handL.x + 1, handL.y - 2],
        [handL.x - 3, 94],
        [b.x, b.y + 2],
      ], 0.9), "j");
      fill(ellipse(handL.x - 6, 92, 4, 1.8), "j", "J");
      fill(ellipse(handL.x + 3.5, 98, 3.5, 1.6), "j", "J");
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        fill(circle(b.x + Math.cos(a) * 3.8, b.y + Math.sin(a) * 3.8, 3.1), p.petals, dark(p.petals));
      }
      fill(circle(b.x, b.y, 2), "y", "Y");
      fill(circle(handL.x + 1, handL.y, 4.2), "n", "N");
      break;
    }
    case "halberd":
      fill(circle(handL.x, handL.y, 4.2), "n", "N");
      break;
    case "leaf": {
      const leaf = intersect(circle(handL.x - 10, 78, 15), circle(handL.x + 7, 66, 15));
      shade(leaf, "j", 1.5);
      fill(capsule(handL.x - 6, 86, handL.x + 3, 58, 0.6), "J");
      fill(capsule(handL.x + 1, handL.y - 2, handL.x - 5, 87, 0.8), "J");
      fill(circle(handL.x + 1, handL.y, 4.2), "n", "N");
      break;
    }
    case "arrow": {
      const a = { x1: handL.x - 2, y1: 132, x2: handL.x + 10, y2: 36 };
      fill(capsule(a.x1, a.y1, a.x2, a.y2, 0.9), "h");
      fill(poly([
        [a.x2 - 3.5, a.y2 + 3],
        [a.x2 + 3.6, a.y2 + 4],
        [a.x2 + 1.2, a.y2 - 6],
      ]), "v", "V");
      for (const [dx, k] of [
        [-3, "r"],
        [3, "b"],
      ] as const)
        fill(poly([
          [a.x1 + 0.5, a.y1 - 4],
          [a.x1 + dx + 0.5, a.y1 - 1],
          [a.x1 + dx + 1.5, a.y1 - 9],
          [a.x1 + 1.5, a.y1 - 12],
        ]), k);
      fill(circle(handL.x + 0.5, handL.y, 4.2), "n", "N");
      break;
    }
  }
  r.clip = null;
  return r;
}

/** The Ace of Spades: an ornate spade of our own design, with gold
 *  filigree, a ribbon with stars and the cabinet's red, blue and yellow. */
export function aceOfSpadesRaster(w: number, h: number): Raster {
  const r = new Raster(w, h);
  const sx = w / 77;
  const sy = h / 162;
  const S = (s: Shape): Shape => shape((x, y) => s.inside(x / sx, y / sy), [s.box[0] * sx, s.box[1] * sy, s.box[2] * sx, s.box[3] * sy]);
  const fill = (s: Shape, k: string, aa?: string) => r.fill(S(s), k, aa);
  const W = 77;
  const H = 162;
  const cx = 38.5;
  const cy = 66;
  fill(roundRect(0, 0, W, H, 4), "q");
  fill(roundRect(1, 1, W - 2, H - 2, 3), "p");
  r.clip = S(roundRect(1, 1, W - 2, H - 2, 3));
  // Sunburst behind the spade.
  fill(
    shape((x, y) => {
      const d = Math.hypot(x - cx, (y - cy) * 0.9);
      if (d > 37) return false;
      const a = Math.atan2(y - cy, x - cx);
      return Math.floor(((a + Math.PI) / (2 * Math.PI)) * 24) % 2 === 0;
    }, [cx - 40, cy - 42, cx + 40, cy + 42]),
    "z",
  );
  fill(diff(ellipse(cx, cy, 36.5, 40.5), ellipse(cx, cy, 35, 39)), "y");
  // The spade.
  const spade = shape((x, y) => {
    const u = (x - (cx - 29)) / 58;
    const v = (y - (cy - 33)) / 64;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 && SPADE(u, v);
  }, [cx - 29, cy - 33, cx + 29, cy + 31]);
  fill(spade, "k", "X");
  const sp = S(spade);
  r.rim(sp, "k", "K", 2, 2);
  r.rim(sp, "k", "g", -2.5, -2.5);
  // Gold inset outline and a blue gem.
  const inner = (pad: number) =>
    shape((x, y) => {
      const u = (x - (cx - 29 + pad)) / (58 - 2 * pad);
      const v = (y - (cy - 33 + pad * 1.05)) / (64 - 2 * pad * 1.05);
      return u >= 0 && u <= 1 && v >= 0 && v <= 0.86 && SPADE(u, v);
    }, [cx - 29, cy - 33, cx + 29, cy + 31]);
  fill(diff(inner(7), inner(9.2)), "y", "Y");
  const gem = shape((x, y) => Math.abs(x - cx) / 6 + Math.abs(y - (cy + 6)) / 8.5 <= 1, [cx - 6, cy - 3, cx + 6, cy + 15]);
  fill(gem, "b", "B");
  r.rim(S(gem), "b", "c", -1.2, -1.2);
  r.rim(S(gem), "b", "B", 1.2, 1.2);
  // Filigree scrolls either side of the stem.
  for (const side of [-1, 1]) {
    const sx0 = cx + side * 19;
    fill(arc(sx0, 104, 7.5, 7.5, side < 0 ? -10 : 190, side < 0 ? 280 : -100, 1.1), "y", "Y");
    fill(arc(sx0 + side * 1.5, 104.5, 3.5, 3.5, side < 0 ? 90 : 90, side < 0 ? 400 : -220, 0.9), "y", "Y");
    fill(arc(cx + side * 14, 26, 9, 6, side < 0 ? 180 : 0, side < 0 ? 300 : -120, 1), "y", "Y");
    fill(circle(cx + side * 22.5, 27.5, 1.6), "r", "R");
  }
  fill(circle(cx, 13, 2.2), "y", "Y");
  fill(capsule(cx - 6, 16.5, cx + 6, 16.5, 0.8), "y");
  // Ribbon with three stars.
  const band = poly([
    [cx - 27, 119],
    [cx + 27, 119],
    [cx + 27, 133],
    [cx - 27, 133],
  ]);
  for (const side of [-1, 1])
    fill(poly([
      [cx + side * 25, 122],
      [cx + side * 36, 122],
      [cx + side * 32, 129.5],
      [cx + side * 36, 137],
      [cx + side * 25, 137],
    ]), "R");
  fill(band, "r");
  r.rim(S(band), "r", "R", 0, 1.5);
  r.rim(S(band), "r", "l", 0, -1.5);
  for (const dx of [-14, 0, 14]) fill(star(cx + dx, 126, 4.6, 2), "y", "Y");
  // Red, blue and yellow diamonds below.
  ["r", "b", "y"].forEach((k, i) => {
    const x = cx + (i - 1) * 11;
    fill(shape((px, py) => Math.abs(px - x) / 3.5 + Math.abs(py - 148) / 5 <= 1, [x - 4, 142, x + 4, 154]), k, dark(k));
  });
  r.clip = null;
  return r;
}

/** Spade on the unit square, as in SUIT_SHAPES but taller-stemmed. */
const SPADE = (u: number, v: number): boolean => {
  const c = (cx: number, cy: number, rr: number) => (u - cx) ** 2 + (v - cy) ** 2 <= rr * rr;
  if (c(0.27, 0.6, 0.235) || c(0.73, 0.6, 0.235)) return true;
  // upper triangle
  if (v >= 0.02 && v <= 0.6) {
    const half = ((v - 0.02) / 0.58) * 0.47;
    if (Math.abs(u - 0.5) <= half) return true;
  }
  if (v > 0.5 && v < 0.68 && u > 0.2 && u < 0.8) return true;
  // stem
  if (v >= 0.62 && v <= 1) {
    const t = (v - 0.62) / 0.38;
    const half = 0.06 + t * t * 0.2;
    if (Math.abs(u - 0.5) <= half) return true;
  }
  return false;
};

/** A five-pointed star. */
function star(cx: number, cy: number, ro: number, ri: number): Shape {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? ro : ri;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return poly(pts);
}
