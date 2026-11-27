// Classic sound pack: bell-like tones and the payout trill, synthesized
// with Web Audio (no recorded or copied machine audio). While a win counts
// up into the credit meter, a fast two-note bell ringing plays for exactly
// as long as the count-up; a bet or deal cuts it off (Sfx.cancelPayout).
// The trill replaces the Basic pack's count-up ticks (not layered over
// them): two ringing sounds at once blur together.
import { TRILL } from "../config/skins";
import { BASIC_SOUNDS, blip } from "./basic";
import type { PayoutCue, SoundPack, Synth } from "./types";

/** One FM bell note on the payout bus: a sine carrier modulated at
 *  `modRatio`× its frequency (index decaying to 0), plus a detuned second
 *  carrier for shimmer. Starts at `t0` (s, context time), silent by `t1`. */
export function bell(s: Synth, freq: number, t0: number, t1: number, opts: { gain?: number; modIndex?: number; out?: AudioNode } = {}) {
  const ac = s.ac;
  const out = opts.out ?? s.payout;
  const peak = 0.22 * s.volume * (opts.gain ?? TRILL.gain);
  const dur = Math.max(0.01, t1 - t0);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(peak, t0 + 0.002);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  amp.connect(out);
  const car = ac.createOscillator();
  car.type = "sine";
  car.frequency.setValueAtTime(freq, t0);
  const mod = ac.createOscillator();
  mod.type = "sine";
  mod.frequency.setValueAtTime(freq * TRILL.modRatio, t0);
  const depth = ac.createGain();
  depth.gain.setValueAtTime(freq * (opts.modIndex ?? TRILL.modIndex), t0);
  depth.gain.exponentialRampToValueAtTime(0.01, t0 + dur);
  mod.connect(depth).connect(car.frequency);
  car.connect(amp);
  const shimmer = ac.createOscillator();
  shimmer.type = "sine";
  shimmer.frequency.setValueAtTime(freq, t0);
  shimmer.detune.setValueAtTime(TRILL.detuneCents, t0);
  const sg = ac.createGain();
  sg.gain.setValueAtTime(0.35, t0);
  shimmer.connect(sg).connect(amp);
  for (const o of [car, mod, shimmer]) {
    o.start(t0);
    o.stop(t0 + dur + 0.005);
    if (out === s.payout) s.track(o);
  }
}

/** Note start times (ms, relative to `atMs`) and pitches of the payout
 *  sound for a cue: what `CLASSIC_SOUNDS.payout` schedules. Every note
 *  starts and ends inside [atMs, atMs + window]. */
export function payoutNotes(c: PayoutCue): { window: number; notes: { at: number; end: number; freq: number; mod: number }[] } {
  const notes: { at: number; end: number; freq: number; mod: number }[] = [];
  const big = c.big || c.top;
  const pitchMul = big ? TRILL.big.pitchMul : 1;
  const rate = TRILL.rate * (big ? TRILL.big.rateMul : 1);
  const mod = TRILL.modIndex * (big ? TRILL.big.modIndexMul : 1);
  const F = TRILL.fanfare;
  const fanfareMs = F.notes.length * F.repeats * F.stepMs;
  // No count-up (instant speed): a ding, or the whole fanfare for a royal.
  const window = c.durMs > 0 ? c.durMs : c.top ? fanfareMs : TRILL.dingMs;
  let t = 0;
  if (c.top) {
    for (let r = 0; r < F.repeats && t < window; r++)
      for (const f of F.notes) {
        if (t >= window) break;
        notes.push({ at: t, end: Math.min(window, t + TRILL.decayMs * 1.6), freq: f, mod: mod * 0.8 });
        t += F.stepMs;
      }
  }
  if (c.durMs <= 0 && !c.top) {
    notes.push({ at: 0, end: window, freq: TRILL.pitches[1] * pitchMul, mod });
    return { window, notes };
  }
  const step = 1000 / rate;
  for (let i = 0; t < window - 1; i++, t += step)
    notes.push({ at: t, end: Math.min(window, t + TRILL.decayMs), freq: TRILL.pitches[i % 2] * pitchMul, mod });
  return { window, notes };
}

export const CLASSIC_SOUNDS: SoundPack = {
  id: "classic",
  name: "Classic bells",
  cards(s, offsetsMs) {
    offsetsMs.forEach((ms, i) => blip(s, 520 + i * 30, 0.035, ms / 1000, "triangle", 0.55));
  },
  hold(s, held) {
    const t = s.ac.currentTime;
    bell(s, held ? 1319 : 880, t, t + 0.07, { gain: 0.7, modIndex: 1.2, out: s.out });
  },
  bet(s) {
    // A coin clink: two quick high bell notes.
    const t = s.ac.currentTime;
    bell(s, 2637, t, t + 0.05, { gain: 0.5, modIndex: 1.6, out: s.out });
    bell(s, 3136, t + 0.03, t + 0.1, { gain: 0.45, modIndex: 1.6, out: s.out });
  },
  dealtWin(s, atMs) {
    const t = s.ac.currentTime + atMs / 1000;
    bell(s, 1568, t, t + 0.12, { gain: 0.8, out: s.out });
    bell(s, 2093, t + 0.07, t + 0.22, { gain: 0.8, out: s.out });
  },
  payout(s, c: PayoutCue) {
    const t0 = s.ac.currentTime + c.atMs / 1000;
    for (const n of payoutNotes(c).notes) bell(s, n.freq, t0 + n.at / 1000, t0 + n.end / 1000, { modIndex: n.mod });
  },
  buzz: BASIC_SOUNDS.buzz,
};
