// Chiptune-style sound effects synthesized with Web Audio (no audio files,
// so no licensing questions). Default muted (SPEC §6.2). The AudioContext
// is created lazily on the first sound after a user gesture.

export class Sfx {
  private ctx: AudioContext | null = null;
  muted: boolean;
  volume: number;

  constructor(muted: boolean, volume: number) {
    this.muted = muted;
    this.volume = volume;
  }

  private ac(): AudioContext | null {
    if (this.muted || typeof AudioContext === "undefined") return null;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** One square/triangle blip. `at` is seconds from now. */
  private tone(freq: number, dur: number, at = 0, type: OscillatorType = "square", gain = 1) {
    const ac = this.ac();
    if (!ac) return;
    const t0 = ac.currentTime + at;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    const peak = 0.25 * this.volume * gain;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Card reveals at the given offsets (ms). */
  cards(offsetsMs: number[]) {
    offsetsMs.forEach((ms, i) => this.tone(660 + i * 40, 0.04, ms / 1000, "square", 0.6));
  }
  hold(held: boolean) {
    this.tone(held ? 880 : 520, 0.05, 0, "triangle");
  }
  bet() {
    this.tone(990, 0.04, 0, "square", 0.6);
  }
  win(atMs: number, big: boolean) {
    const notes = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
    notes.forEach((f, i) => this.tone(f, 0.09, atMs / 1000 + i * 0.07, "square"));
  }
  /** Count-up ticks spread over `durMs`. */
  countUp(atMs: number, durMs: number) {
    const n = Math.min(24, Math.max(1, Math.round(durMs / 40)));
    for (let i = 0; i < n; i++) this.tone(1200, 0.02, (atMs + (i * durMs) / n) / 1000, "square", 0.35);
  }
  buzz() {
    this.tone(110, 0.08, 0, "square", 0.5);
  }
}
