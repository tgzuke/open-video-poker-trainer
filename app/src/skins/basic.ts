// Basic theme (the default): the original cards and sounds, unchanged (moved here from
// render/cabinet.ts and audio/sfx.ts).
import { LAYOUT } from "../config/feel";
import { BASIC_COLORS as P } from "../config/skins";
import { RANK_TEXT, SUIT_IS_RED } from "../render/font";
import type { Pix } from "../render/pix";
import type { BackSkin, FaceSkin, PayoutCue, SoundPack, Synth } from "./types";

const C = LAYOUT.cards;

export const BASIC_FACES: FaceSkin = {
  id: "basic",
  name: "Basic",
  cached: false,
  indexColors: (suit) => ({ ink: SUIT_IS_RED[suit] ? P.suitRed : P.suitBlack, paper: P.cardFace }),
  draw(p: Pix, x: number, y: number, w: number, h: number, rank: number, suit: number) {
    // Rounded corners: inset the corner pixels.
    p.rect(x + 1, y, w - 2, h, P.cardEdge);
    p.rect(x, y + 1, w, h - 2, P.cardEdge);
    p.rect(x + 1, y + 1, w - 2, h - 2, P.cardFace);
    if (w < C.w) return; // mid-flip: plain face
    const color = SUIT_IS_RED[suit] ? P.suitRed : P.suitBlack;
    const r = RANK_TEXT[rank];
    p.text(r, x + 4, y + 4, 2, color);
    p.suit(suit, x + 4, y + 21, 1, color);
    p.suit(suit, x + Math.round((C.w - 27) / 2), y + 44, 3, color);
  },
};

export const BASIC_BACK: BackSkin = {
  id: "basic",
  name: "Basic",
  cached: false,
  draw(p: Pix, x: number, y: number, w: number, h: number) {
    p.rect(x + 1, y, w - 2, h, P.cardEdge);
    p.rect(x, y + 1, w, h - 2, P.cardEdge);
    p.rect(x + 1, y + 1, w - 2, h - 2, P.cardFace);
    if (w <= 4) return;
    p.rect(x + 3, y + 3, w - 6, h - 6, P.cardBack);
    // Diamond lattice.
    for (let yy = 6; yy < h - 6; yy += 6)
      for (let xx = 6 + ((yy / 6) % 2) * 3; xx < w - 6; xx += 6) p.rect(x + xx, y + yy, 2, 2, P.cardBackPattern);
  },
};

/** One square/triangle blip. `at` is seconds from now. */
export function blip(s: Synth, freq: number, dur: number, at = 0, type: OscillatorType = "square", gain = 1, out: AudioNode = s.out) {
  const ac = s.ac;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  const peak = 0.25 * s.volume * gain;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  if (out !== s.out) s.track(osc);
}

/** The original chiptune effects (SPEC §6.2). */
export const BASIC_SOUNDS: SoundPack = {
  id: "basic",
  name: "Basic chiptune",
  cards(s, offsetsMs) {
    offsetsMs.forEach((ms, i) => blip(s, 660 + i * 40, 0.04, ms / 1000, "square", 0.6));
  },
  hold(s, held) {
    blip(s, held ? 880 : 520, 0.05, 0, "triangle");
  },
  bet(s) {
    blip(s, 990, 0.04, 0, "square", 0.6);
  },
  dealtWin(s, atMs) {
    [784, 1175].forEach((f, i) => blip(s, f, 0.08, atMs / 1000 + i * 0.06, "triangle", 0.9));
  },
  payout(s, c: PayoutCue) {
    const notes = c.big ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
    notes.forEach((f, i) => blip(s, f, 0.09, c.atMs / 1000 + i * 0.07, "square"));
    // Count-up ticks spread over the count, starting after the jingle.
    if (c.durMs > 0) {
      const at = c.atMs + 200;
      const n = Math.min(24, Math.max(1, Math.round(c.durMs / 40)));
      for (let i = 0; i < n; i++) blip(s, 1200, 0.02, (at + (i * c.durMs) / n) / 1000, "square", 0.35);
    }
  },
  buzz(s) {
    blip(s, 110, 0.08, 0, "square", 0.5);
  },
};
