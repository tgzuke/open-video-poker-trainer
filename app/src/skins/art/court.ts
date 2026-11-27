// Default theme: court card portraits (J, Q, K) and the A♠ crest. These are
// small busts in the card's upper-right corner (the large suit stays on
// the card, as on real video poker machines), drawn as chunky pixel art
// on a 36×40 sprite grid: flat colours, one shade, dark outlines, and
// hand-placed faces. Parts (hair, crown or cap, collar, robe, held object)
// are combined per rank and suit, and a seeded generator picks colours
// and the robe pattern, so each card is distinct and always the same.
// Loosely after the old English-pattern court cards; our own drawings.
import { Raster, capsule, circle, diff, ellipse, intersect, poly, rect, rng, shape, union, type Shape } from "../raster";

/** Sprite grid (each sprite pixel is a block of art pixels on the card). */
export const SPRITE_W = 36;
export const SPRITE_H = 40;

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
  H: ["K", "h"],
};
const dark = (k: string) => TONES[k]?.[0] ?? k;
const light = (k: string) => TONES[k]?.[1] ?? k;
/** Every key a part can be painted in (for outlining). */
const ANY = "rRlbBcyYzkKgwvjJhHaoVOnNmpqx";

/** Hand-placed faces (18×19). K outline, n skin, N shade, w/k eye, H
 *  brow, R mouth, m cheek. */
const FACE_FRONT = [
  "......KKKKKK......",
  "....KKnnnnnnKK....",
  "...KnnnnnnnnnnK...",
  "..KnnnnnnnnnnnnK..",
  ".KnnnnnnnnnnnnnNK.",
  ".KnnnnnnnnnnnnnNK.",
  "KnnHHHHnnnnHHHHnNK",
  "KnnnnnnnnnnnnnnnNK",
  "KnnwkknnnnnnwkknNK",
  "KnnnnnnnnnnnnnnnNK",
  "KnnnnnnnNnnnnnnnNK",
  "KmmnnnnnNnnnnnmmNK",
  "KnnnnnnNNnnnnnnnNK",
  ".KnnnnnnnnnnnnnNK.",
  ".KnnnnRRRRRnnnnNK.",
  "..KnnnnnnnnnnnNK..",
  "...KnnnnnnnnnNK...",
  "....KKnnnnnnKK....",
  "......KKKKKK......",
];

/** Facing left. */
const FACE_PROFILE = [
  ".......KKKKKK.....",
  ".....KKnnnnnnKK...",
  "....KnnnnnnnnnnK..",
  "...KnnnnnnnnnnnnK.",
  "..KnnnnnnnnnnnnNK.",
  "..KnnnnnnnnnnnnNK.",
  "..KHHHHnnnnnnnnnNK",
  "..KnnnnnnnnnnnnnNK",
  "..KwkknnnnnnNNnnNK",
  ".KnnnnnnnnnNnnNnNK",
  "KnnnnnnnnnnNNNnnNK",
  "KKnnnnnnnnnnnnnnNK",
  ".KmnnnnnnnnnnnnNK.",
  ".KRRRnnnnnnnnnnNK.",
  "..KnnnnnnnnnnnNK..",
  "...KnnnnnnnnnNK...",
  "....KKnnnnnnKK....",
  "......KKKKKK......",
];

type Pattern = "stripes" | "dots" | "checks" | "chevrons" | "diamonds";
const PATTERNS: Pattern[] = ["stripes", "dots", "checks", "chevrons", "diamonds"];

/** What a court card looks like (decided from rank, suit and the seed). */
export interface CourtPlan {
  rank: 11 | 12 | 13;
  suit: number;
  profile: boolean;
  robe: string;
  panel: string;
  ink: string;
  hair: string;
  pattern: Pattern;
  held: "sword" | "swordBehind" | "axe" | "orb" | "flower" | "halberd" | "leaf" | "arrow";
  gems: string[];
  petals: string;
  plume: string;
  /** Background tint behind the bust. */
  back: string;
}

export function courtPlan(rank: 11 | 12 | 13, suit: number, seed = 0): CourtPlan {
  const rand = rng(rank * 1009 + suit * 101 + seed * 7919 + 17);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length) % xs.length];
  // Robes in the cabinet's red and blue, the front panel in another
  // colour, trimmed in gold; hearts and diamonds lean red.
  const robe = suit === 1 || suit === 2 ? pick(["r", "r", "b"]) : pick(["b", "b", "r"]);
  const panel = pick(["y", "k", robe === "r" ? "b" : "r"]);
  const ink = pick(["w", "y", "k", "r", "b"].filter((k) => k !== panel));
  // Hair by rank and suit, so the four of a rank never look alike.
  const hair = ({ 13: ["o", "H", "a", "h"], 12: ["y", "a", "H", "h"], 11: ["h", "y", "a", "H"] } as const)[rank][suit];
  // Traditional quirks: the king of hearts' sword behind his head, the king
  // of diamonds with an axe, in profile; one-eyed jacks of spades and hearts.
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
    hair,
    pattern: pick(PATTERNS),
    held,
    gems: [pick(["r", "b", "j"]), pick(["b", "r", "j"]), pick(["j", "r", "b"])],
    petals: pick(["r", "b", "l", "c"]),
    plume: pick(["w", "c", "l", "y"]),
    back: pick(["p", "p", "z", "w"]),
  };
}

/** A sprite-grid raster with crisp (unsmoothed) parts and dark outlines. */
class Sprite extends Raster {
  /** Fills a part, shades it, and outlines its edge (inner 1-pixel rim). */
  part(s: Shape, key: string, opts: { edge?: string; shade?: boolean } = {}) {
    this.fill(s, key);
    if (opts.shade !== false && dark(key) !== key) {
      this.rim(s, key, dark(key), 2, 0); // shade on the right
      this.rim(s, key, light(key), -2, -2); // light, upper left
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      this.rim(s, ANY, opts.edge ?? "K", dx, dy);
  }

  /** Stamps a hand-drawn template ("." transparent) at (x, y). */
  template(rows: string[], x: number, y: number, map: Record<string, string> = {}) {
    rows.forEach((row, j) => [...row].forEach((k, i) => k !== "." && this.set(x + i, y + j, map[k] ?? k)));
  }
}

/** Robe pattern on the front panel. */
function pattern(s: Sprite, area: Shape, p: CourtPlan) {
  s.fill(area, p.panel);
  const at = (f: (x: number, y: number) => boolean) => s.fill(intersect(area, shape((x, y) => f(Math.floor(x), Math.floor(y)))), p.ink);
  switch (p.pattern) {
    case "stripes":
      at((_, y) => y % 3 === 0);
      break;
    case "dots":
      at((x, y) => (x + y) % 3 === 0 && y % 2 === 0);
      break;
    case "checks":
      at((x, y) => (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0);
      break;
    case "chevrons":
      at((x, y) => (y + Math.abs(x - 18)) % 4 === 0);
      break;
    case "diamonds":
      at((x, y) => (Math.abs(x - 18) + y) % 4 === 0 || (Math.abs(x - 18) - y + 40) % 4 === 0);
      break;
  }
}

/** The bust, on the 36×40 sprite grid. */
export function bustSprite(p: CourtPlan): Raster {
  const s = new Sprite(SPRITE_W, SPRITE_H);
  const W = SPRITE_W;
  const H = SPRITE_H;
  const cx = 18;
  const king = p.rank === 13;
  const queen = p.rank === 12;
  const face = p.profile ? -1 : 1;

  // Frame and background.
  s.fill(rect(0, 0, W, H), "K");
  s.fill(rect(1, 1, W - 2, H - 2), p.back);
  s.fill(diff(rect(2, 2, W - 4, H - 4), rect(3, 3, W - 6, H - 6)), "Y");
  s.clip = rect(1, 1, W - 2, H - 2);

  // Behind the head: a sword over the shoulder, a pole, long hair.
  if (p.held === "swordBehind") {
    s.part(capsule(5, 38, 33, 2, 1.1), "v");
    s.part(rect(3, 32, 8, 2), "y", { shade: false });
  }
  if (p.held === "halberd") {
    s.part(rect(3, 6, 2, H), "h", { shade: false });
    s.part(
      poly([
        [4, 5],
        [8.5, 3],
        [9, 11],
        [4, 12],
      ]),
      "v",
    );
    s.part(rect(3, 1, 2, 5), "v", { shade: false });
  }
  if (p.held === "axe") {
    s.part(rect(31, 5, 2, H), "h", { shade: false });
    s.part(diff(ellipse(34, 9, 4, 6), ellipse(37.5, 9, 2.5, 5)), "v");
  }
  if (p.held === "sword") {
    s.part(rect(31, 2, 3, 28), "v", { shade: false });
    s.fill(rect(32, 3, 1, 26), "w");
  }
  const hairBack = king
    ? ellipse(cx + (p.profile ? 2 : 0), 18, 12.5, 12.5)
    : queen
      ? union(ellipse(cx, 17, 12.5, 11.5), rect(5.5, 17, 25, 17))
      : ellipse(cx + (p.profile ? 3 : 0), 18, 11.5, 10);
  s.part(hairBack, p.hair);

  // Shoulders, robe and front panel.
  s.part(union(ellipse(cx, 45, 18, 14), rect(1, 38, W - 2, 6)), p.robe);
  const panelArea = poly([
    [cx - 4, 32],
    [cx + 4, 32],
    [cx + 6, H],
    [cx - 6, H],
  ]);
  s.part(
    poly([
      [cx - 5, 32],
      [cx + 5, 32],
      [cx + 7.5, H],
      [cx - 7.5, H],
    ]),
    "y",
    { shade: false },
  );
  pattern(s, panelArea, p);

  // Neck.
  s.fill(rect(cx - 3, 26, 6, 6), "n");
  s.fill(rect(cx + 1, 26, 2, 6), "N");

  // Collar.
  if (king) {
    s.part(diff(ellipse(cx, 33, 12, 4.5), ellipse(cx, 30, 5, 3)), "w", { shade: false });
    for (const x of [cx - 8, cx - 4, cx + 3, cx + 7]) s.set(x, 33, "k");
  } else if (queen) {
    for (let i = 0; i < 8; i++) s.part(circle(cx - 10.5 + i * 3, 32.5, 2.1), "w", { shade: false });
  } else {
    s.part(
      poly([
        [cx - 8, 31],
        [cx + 8, 31],
        [cx, 37],
      ]),
      "y",
    );
  }

  // Head: a hand-drawn face, brows in the hair's dark tone.
  s.template(p.profile ? FACE_PROFILE : FACE_FRONT, 9, 9, { H: dark(p.hair) });

  // Fringe over the forehead (queens and jacks).
  if (!king) s.part(intersect(ellipse(cx + (p.profile ? 1 : 0), 11, 9.5, 5), rect(8, 5, 20, 9)), p.hair, { shade: false });

  // King's beard and moustache.
  if (king) {
    const beard = p.profile ? intersect(ellipse(cx - 2, 25, 8.5, 6.5), rect(9, 21, 18, 10)) : intersect(ellipse(cx, 25, 9.5, 7), rect(8, 21, 20, 11));
    s.part(beard, p.hair);
    if (p.profile) s.template(["KKK", "RRR"], 10, 21);
    else s.template(["KKKK..KKKK", "...RRRR..."], cx - 5, 21);
  }

  // Headwear.
  if (king) {
    // Crown: a velvet cap, a band, five points, jewels.
    s.fill(ellipse(cx, 6, 7, 4), p.robe === "r" ? "b" : "r");
    const pts = [-7.5, -3.75, 0, 3.75, 7.5].map((dx) =>
      poly([
        [cx + dx - 2, 7],
        [cx + dx + 2, 7],
        [cx + dx, dx === 0 ? 0 : Math.abs(dx) > 5 ? 2.5 : 1.5],
      ]),
    );
    s.part(union(rect(cx - 9, 6, 18, 5), ...pts), "y");
    [-5, 0, 5].forEach((dx, i) => {
      s.set(cx + dx - 1, 8, p.gems[i]);
      s.set(cx + dx, 8, p.gems[i]);
    });
  } else if (queen) {
    const pts = [-5, 0, 5].map((dx) =>
      poly([
        [cx + dx - 2, 6],
        [cx + dx + 2, 6],
        [cx + dx, 2],
      ]),
    );
    s.part(union(rect(cx - 7, 5, 14, 3), ...pts), "y");
    [-3, 2].forEach((dx, i) => s.set(cx + dx, 6, p.gems[i]));
    for (const dx of [-5, 0, 5]) s.part(circle(cx + dx + 0.5, 2, 1.1), "z", { shade: false });
  } else {
    // Jack's cap and plume.
    s.part(union(ellipse(cx - face, 7, 10.5, 4), rect(cx - 10 - face, 7, 20, 3)), p.robe === "r" ? "b" : "r");
    s.fill(rect(cx - 9 - face, 8, 18, 1), "y");
    s.part(capsule(cx + 6, 5, cx + 13, 0, 1.2), p.plume, { shade: false });
  }

  // The held object, in front.
  switch (p.held) {
    case "sword":
      s.part(rect(28, 29, 10, 2), "y", { shade: false });
      s.part(rect(31, 31, 3, 4), "h", { shade: false });
      s.part(circle(32.5, 36, 2.3), "n", { shade: false });
      break;
    case "swordBehind":
      s.part(circle(7, 36.5, 2.3), "n", { shade: false });
      break;
    case "axe":
      s.part(circle(32, 33, 2.3), "n", { shade: false });
      break;
    case "orb":
      s.part(circle(30.5, 30.5, 3.8), "y");
      s.part(rect(30, 24.5, 1, 3), "y", { shade: false });
      s.part(rect(29, 25.5, 3, 1), "y", { shade: false });
      s.part(circle(30.5, 36, 2.3), "n", { shade: false });
      break;
    case "flower": {
      // A rose: five petals round a gold centre, on a green stem.
      s.part(rect(5, 23, 1, 12), "j", { shade: false });
      s.part(ellipse(3.5, 29, 2, 1), "j", { shade: false });
      s.part(ellipse(7.5, 31, 2, 1), "j", { shade: false });
      const fx = 5.5;
      const fy = 20.5;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        s.part(circle(fx + Math.cos(a) * 2.2, fy + Math.sin(a) * 2.2, 1.7), p.petals, { shade: false });
      }
      s.fill(rect(5, 20, 1, 1), "y");
      s.part(circle(5.5, 36, 2.3), "n", { shade: false });
      break;
    }
    case "halberd":
      s.part(circle(4, 35, 2.3), "n", { shade: false });
      break;
    case "leaf":
      s.part(intersect(circle(2, 25, 8), circle(10, 20, 8)), "j");
      s.part(capsule(4, 29, 8, 17, 0.3), "J", { shade: false });
      s.part(circle(5.5, 35, 2.3), "n", { shade: false });
      break;
    case "arrow":
      s.part(capsule(3, 39, 8, 8, 0.6), "h", { shade: false });
      s.part(
        poly([
          [6, 9],
          [10.5, 9.5],
          [9, 2.5],
        ]),
        "v",
        { shade: false },
      );
      s.part(circle(5, 35, 2.3), "n", { shade: false });
      break;
  }
  s.clip = null;
  return s;
}

/** Scales a raster to w×h by nearest neighbour (keeps hard pixel edges). */
export function scaled(src: Raster, w: number, h: number): Raster {
  const r = new Raster(w, h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = src.get(Math.floor((i * src.w) / w), Math.floor((j * src.h) / h));
      if (k !== ".") r.set(i, j, k);
    }
  return r;
}

/** A court card's bust, sized to the art box. */
export function courtRaster(plan: CourtPlan, w: number, h: number): Raster {
  return scaled(bustSprite(plan), w, h);
}

/** The A♠ corner crest: a small spade on a crowned, gold-rimmed shield,
 *  with a red ribbon and stars. Our own design. */
export function aceCrestSprite(): Raster {
  const s = new Sprite(SPRITE_W, SPRITE_H);
  const cx = 18;
  const shield = intersect(union(rect(7, 8, 22, 12), ellipse(cx, 20, 11, 12)), rect(0, 0, 36, 31));
  s.part(shield, "y", { shade: false });
  s.part(intersect(union(rect(9, 10, 18, 10), ellipse(cx, 20, 9, 10)), rect(0, 0, 36, 29)), "b");
  // A white spade on the shield.
  s.template(
    [
      "....w....",
      "...www...",
      "..wwwww..",
      ".wwwwwww.",
      "wwwwwwwww",
      "wwwwwwwww",
      ".ww.w.ww.",
      "....w....",
      "...www...",
    ],
    cx - 4,
    13,
  );
  // Crown above the shield.
  s.part(
    union(
      rect(cx - 6, 3, 12, 4),
      poly([
        [cx - 6, 4],
        [cx - 6, 0],
        [cx - 3, 4],
      ]),
      poly([
        [cx - 2, 4],
        [cx, 0],
        [cx + 2, 4],
      ]),
      poly([
        [cx + 6, 4],
        [cx + 6, 0],
        [cx + 3, 4],
      ]),
    ),
    "y",
  );
  s.set(cx, 5, "r");
  // Ribbon with three stars.
  s.part(
    poly([
      [0, 31],
      [5, 31],
      [5, 39],
      [0, 39],
      [2.5, 35],
    ]),
    "R",
    { shade: false },
  );
  s.part(
    poly([
      [36, 31],
      [31, 31],
      [31, 39],
      [36, 39],
      [33.5, 35],
    ]),
    "R",
    { shade: false },
  );
  s.part(rect(3, 30, 30, 7), "r");
  for (const x of [11, 18, 25]) s.template([".y.", "yyy", ".y."], x - 1, 32);
  return s;
}

export function aceCrestRaster(w: number, h: number): Raster {
  return scaled(aceCrestSprite(), w, h);
}
