// Skins: how cards look and how the machine sounds. A skin has three
// independent parts (faces, backs, sounds); a theme is a named bundle of
// one of each. Everything is drawn or synthesized in code: no image or
// audio files.
import type { Pix } from "../render/pix";

/** Draws card faces into a card rect (logical pixels). */
export interface FaceSkin {
  id: string;
  name: string;
  /** `w` is narrower than the card during a flip; `h` is the card height. */
  draw(p: Pix, x: number, y: number, w: number, h: number, rank: number, suit: number): void;
  /** true: the cabinet pre-renders each face once per screen scale and
   *  blits it (squeezing it during a flip). false: drawn directly every
   *  frame, at every flip width. */
  cached: boolean;
  /** Index colours (rank/suit ink and the face behind it) per suit, for
   *  the legibility check. */
  indexColors(suit: number): { ink: string; paper: string };
}

/** Draws a card back. */
export interface BackSkin {
  id: string;
  name: string;
  draw(p: Pix, x: number, y: number, w: number, h: number): void;
  cached: boolean;
}

/** What a sound pack is given to play through. */
export interface Synth {
  readonly ac: AudioContext;
  /** Main output. */
  readonly out: AudioNode;
  /** Output that `Sfx.cancelPayout()` silences at once. */
  readonly payout: AudioNode;
  readonly volume: number;
  /** Register a scheduled source so a cancel can stop it. */
  track(node: AudioScheduledSourceNode): void;
}

export interface PayoutCue {
  /** When the count-up starts and how long it runs (ms from now). */
  atMs: number;
  durMs: number;
  amount: number;
  bet: number;
  /** A big win (the cabinet's threshold: 50× the bet or more). */
  big: boolean;
  /** The top pay line (royal flush). */
  top: boolean;
}

/** A sound pack implementing the cabinet's sound cues. */
export interface SoundPack {
  id: string;
  name: string;
  /** Card reveals at the given offsets (ms). */
  cards(s: Synth, offsetsMs: number[]): void;
  hold(s: Synth, held: boolean): void;
  bet(s: Synth): void;
  /** The dealt hand already pays. */
  dealtWin(s: Synth, atMs: number): void;
  /** A win: its jingle and the sound of the credit count-up. */
  payout(s: Synth, cue: PayoutCue): void;
  buzz(s: Synth): void;
}

export interface Theme {
  id: string;
  name: string;
  faces: string;
  backs: string;
  sounds: string;
}
