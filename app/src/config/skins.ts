// Card art and sound settings for the skins, for playtesting (CLAUDE.md:
// change values, not code). See docs/progress.md "For playtesting".

/** Theme for new players (and saved prefs from before themes). */
export const DEFAULT_THEME = "default";

/** Basic theme colours (the original cards). */
export const BASIC_COLORS = {
  cardFace: "#f8f8f0",
  cardEdge: "#202020",
  cardBack: "#c81818",
  cardBackPattern: "#ffd800",
  suitRed: "#d01818",
  suitBlack: "#101010",
};

/** Default theme, court cards and the A♠: where the art box sits on the
 *  card, as fractions of the card's width/height (index column on the
 *  left). Bottom-right instead: e.g. { x: 0.36, y: 0.2, w: 0.6, h: 0.76 }. */
export const ART_BOX = { x: 0.36, y: 0.04, w: 0.6, h: 0.92 };

/** Default theme art grid: art pixels per logical pixel (2 = a 128×176
 *  grid on a 64×88 card). */
export const ART_SCALE = 2;

/** Default theme colours, by palette key (single characters, used by the
 *  art code). Reds, blues and yellows come from the cabinet's scheme. */
export const FACE_PALETTE: Record<string, string> = {
  // card
  f: "#f6f2e7", // face (warm off-white)
  s: "#ddd5c2", // face shadow (right/bottom inner edge)
  e: "#1e1e28", // card edge
  // red ink and robes
  r: "#d21c1c",
  R: "#8a0e0e",
  l: "#ff6b57",
  x: "#eba79a", // red anti-alias tone over the face
  // blue
  b: "#1f3ad0",
  B: "#0b1a7a",
  c: "#6f8cff",
  // yellow / gold
  y: "#ffd400",
  Y: "#b78800",
  z: "#fff0a0",
  // black ink
  k: "#16161f",
  K: "#000000",
  g: "#5c5c78",
  X: "#a9a7ad", // black anti-alias tone over the face
  // skin, hair
  n: "#f3c89c",
  N: "#d49a6a",
  m: "#e88b7a",
  h: "#6b3d1e",
  H: "#3b200e",
  a: "#a8551f",
  o: "#9a968f",
  O: "#dedad2",
  // white, silver, green
  w: "#ffffff",
  v: "#c9cfd8",
  V: "#7c8594",
  j: "#2f9a3a",
  J: "#17561d",
  // art box
  p: "#f4e6bf", // box background
  q: "#b78800", // box frame
};

/** Payout trill (Default sound pack): a fast, bell-like two-note ringing
 *  that lasts exactly as long as the credit count-up. */
export const TRILL = {
  /** Notes per second (real machines: roughly 15–25). */
  rate: 20,
  /** The two alternating pitches (Hz). */
  pitches: [1568, 1760] as [number, number],
  /** Bell timbre: FM carrier : modulator ratio, start modulation index
   *  (decays to 0 with the note), and a second detuned carrier. */
  modRatio: 3.5,
  modIndex: 2.2,
  detuneCents: 7,
  /** Note length (ms): the bell's decay. */
  decayMs: 110,
  gain: 0.55,
  /** Big wins (50× bet+): one step brighter and a little faster. */
  big: { pitchMul: 1.25, rateMul: 1.15, modIndexMul: 1.4 },
  /** Royal (top line): a rising fanfare first, then the brighter trill. */
  fanfare: { notes: [1047, 1319, 1568, 2093, 2637, 3136], stepMs: 70, repeats: 2 },
  /** A win at instant speed (no count-up): one ding. */
  dingMs: 180,
};
