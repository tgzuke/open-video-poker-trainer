// Sound effects synthesized with Web Audio (no audio files, so no
// licensing questions). Default muted (SPEC §6.2). The AudioContext is
// created lazily on the first sound after a user gesture, and never while
// muted. What each cue sounds like comes from the sound pack (skins/).
import { BASIC_SOUNDS } from "../skins/basic";
import type { PayoutCue, SoundPack, Synth } from "../skins/types";

export class Sfx {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private tracked = new Set<AudioScheduledSourceNode>();
  muted: boolean;
  volume: number;
  pack: SoundPack;

  constructor(
    muted: boolean,
    volume: number,
    pack: SoundPack = BASIC_SOUNDS,
    /** AudioContext constructor (tests pass a mock). */
    private makeContext: (() => AudioContext) | null = typeof AudioContext === "undefined" ? null : () => new AudioContext(),
  ) {
    this.muted = muted;
    this.volume = volume;
    this.pack = pack;
  }

  /** Created contexts so far (0 or 1). */
  get contexts(): number {
    return this.ctx ? 1 : 0;
  }

  private synth(): Synth | null {
    if (this.muted || !this.makeContext) return null;
    if (!this.ctx) this.ctx = this.makeContext();
    const ac = this.ctx;
    if (ac.state === "suspended") void ac.resume();
    if (!this.bus) {
      this.bus = ac.createGain();
      this.bus.connect(ac.destination);
    }
    const tracked = this.tracked;
    return {
      ac,
      out: ac.destination,
      payout: this.bus,
      volume: this.volume,
      track(node) {
        tracked.add(node);
        node.onended = () => tracked.delete(node);
      },
    };
  }

  /** Silences the payout sound now (a bet or deal during the count-up).
   *  Never waits: scheduled notes are stopped and the bus is cut. */
  cancelPayout() {
    if (!this.ctx || !this.bus) return;
    const t = this.ctx.currentTime;
    for (const n of this.tracked) {
      try {
        n.stop(t);
      } catch {
        /* already stopped */
      }
    }
    this.tracked.clear();
    this.bus.disconnect();
    this.bus = null;
  }

  /** Card reveals at the given offsets (ms). */
  cards(offsetsMs: number[]) {
    const s = this.synth();
    if (s) this.pack.cards(s, offsetsMs);
  }
  hold(held: boolean) {
    const s = this.synth();
    if (s) this.pack.hold(s, held);
  }
  bet() {
    const s = this.synth();
    if (s) this.pack.bet(s);
  }
  /** Dealt hand already pays. */
  dealtWin(atMs: number) {
    const s = this.synth();
    if (s) this.pack.dealtWin(s, atMs);
  }
  /** A win's jingle and count-up sound. */
  payout(cue: PayoutCue) {
    const s = this.synth();
    if (s) this.pack.payout(s, cue);
  }
  buzz() {
    const s = this.synth();
    if (s) this.pack.buzz(s);
  }
}
