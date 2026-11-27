// The playable game: input → model → animation/sound → renderer.
import { AUTO_REFILL, countUpMs, SPEED_TABLE, STARTING_CREDITS } from "../config/feel";
import { buttonToAction, type GameButton } from "../input/actions";
import { Anim } from "../render/anim";
import { drawCabinet, type CabinetView } from "../render/cabinet";
import { Pix } from "../render/pix";
import { Sfx } from "../audio/sfx";
import type { Rules as WasmRules } from "../wasm/ovp_engine.js";
import { apply, cryptoRng, initialState, type GameEvent, type GameState, type Rng, type Rules } from "./model";
import { modelRules, payGrid } from "./rules";
import type { Mode } from "../config/trainer";
import type { Trainer } from "../trainer/trainer";
import { CardRenderer } from "../skins/cards";
import { BASIC_BACK, BASIC_FACES } from "../skins/basic";

export interface Table {
  wasm: WasmRules;
  label: string; // display label incl. table name
  lineNames: string[];
}

export class GameApp {
  state: GameState;
  rules: Rules;
  anim: Anim;
  sfx: Sfx;
  private view!: CabinetView;
  private frame = 0;
  /** Called after every state change (e.g. to save credits). */
  onChange: (s: GameState) => void = () => {};
  /** Latency probe: time from button press to the frame that shows it. */
  lastInputToFrameMs = 0;
  private pendingInputAt: number | null = null;
  /** Lesson mode: a Draw pressed before the hand's check arrived. */
  private queuedDraw = false;
  /** Trainer (null = plain game, as in tests). */
  trainer: Trainer | null = null;
  mode: () => Mode = () => "free";
  /** Strategy tag text for the screen (null hides it). */
  tag: () => string | null = () => null;
  /** Drawn over the cabinet (e.g. the strategy view), or null. */
  overlay: ((p: Pix) => void) | null = null;
  /** Card faces and backs (the skin). */
  cards = new CardRenderer(BASIC_FACES, BASIC_BACK);
  /** Frame timing: last and worst draw time (ms) since `resetFrameStats`. */
  frameStats = { last: 0, worst: 0, total: 0, frames: 0 };

  constructor(
    private pix: Pix,
    private table: Table,
    progressive: number | null,
    credits: number,
    bet: number,
    speed: number,
    sfx: Sfx,
    private rng: Rng = cryptoRng,
  ) {
    this.rules = modelRules(table.wasm, progressive);
    this.state = initialState(credits, Math.min(Math.max(1, bet), this.rules.maxBet));
    this.anim = new Anim(speed);
    this.sfx = sfx;
    this.rebuildView();
  }

  private rebuildView() {
    const t = this.table;
    this.view = {
      state: this.state,
      lineNames: t.lineNames.map((n) => n.toUpperCase()),
      payGrid: payGrid(this.rules, t.lineNames.length),
      label: t.label.toUpperCase(),
      rank: (c) => t.wasm.rank(c),
      suit: (c) => t.wasm.suit(c),
      trainer: { mode: "free", tag: null, feedback: null, lesson: null },
      cards: this.cards,
    };
  }

  /** Switch the card skin (the next frame uses it). */
  setCards(cards: CardRenderer) {
    this.cards = cards;
    this.view.cards = cards;
    this.request();
  }

  resetFrameStats() {
    this.frameStats = { last: 0, worst: 0, total: 0, frames: 0 };
  }

  /** Switch game / pay table / progressive (only between hands). */
  setTable(table: Table, progressive: number | null): boolean {
    if (this.state.phase !== "ready") return false;
    this.table = table;
    this.rules = modelRules(table.wasm, progressive);
    this.state = { ...this.state, bet: Math.min(this.state.bet, this.rules.maxBet), hands: [], lastWin: 0 };
    this.anim.finish();
    this.anim.clearFlash();
    this.rebuildView();
    this.request();
    return true;
  }

  /** Game label + pay table, upper-case (as on the screen). */
  label(): string {
    return this.table.label.toUpperCase();
  }

  lineNames(): string[] {
    return this.table.lineNames;
  }

  setSpeed(speed: number) {
    this.anim.speed = speed;
  }

  setCredits(credits: number) {
    this.state = { ...this.state, credits };
    this.onChange(this.state);
    this.request();
  }

  /** Wire a trainer in; it re-renders (and runs a queued Draw) when a
   *  check arrives. */
  attachTrainer(trainer: Trainer, mode: () => Mode) {
    this.trainer = trainer;
    this.mode = mode;
    trainer.onChange = () => {
      if (this.queuedDraw && trainer.checkReady) {
        this.queuedDraw = false;
        this.press("dealDraw");
      }
      this.request();
    };
  }

  press(b: GameButton) {
    const now = performance.now();
    this.pendingInputAt = now;
    const action = buttonToAction(b);
    if (action.type === "dealDraw" && this.state.phase === "dealt" && this.trainer) {
      const gate = this.trainer.gate(this.state.hands[0].held);
      if (gate === "wait") {
        this.queuedDraw = true;
        return;
      }
      if (gate === "block") {
        this.sfx.buzz();
        this.request();
        return;
      }
    }
    const { state, events } = apply(this.state, action, this.rules, this.rng, {
      startingCredits: STARTING_CREDITS,
      autoRefill: AUTO_REFILL,
    });
    if (events.some((e) => e.type === "deal")) this.anim.clearFlash();
    this.state = state;
    if (this.trainer) {
      for (const e of events) {
        if (e.type === "deal") this.trainer.dealt(e.cards, state.bet);
        if (e.type === "draw") {
          const cat = state.hands[0].category;
          this.trainer.drawn(state.lastWin, cat !== null && cat < this.table.lineNames.length ? this.table.lineNames[cat] : "No win");
        }
      }
    }
    this.anim.onEvents(events, now);
    this.sounds(events);
    this.onChange(state);
    this.request();
  }

  private sounds(events: GameEvent[]) {
    const t = SPEED_TABLE[this.anim.speed] ?? SPEED_TABLE[4];
    let revealEnd = 0;
    for (const e of events) {
      switch (e.type) {
        case "bet":
          this.sfx.cancelPayout(); // a bet during the count-up stops its sound
          this.sfx.bet();
          break;
        case "deal":
          this.sfx.cancelPayout();
          this.sfx.cards([0, 1, 2, 3, 4].map((i) => i * t.cardStepMs));
          revealEnd = 4 * t.cardStepMs + t.flipMs;
          // A dealt hand that already pays gets its own cue, as on a cabinet.
          if (this.state.dealtCategory !== null) this.sfx.dealtWin(revealEnd);
          break;
        case "draw":
          this.sfx.cards(e.replaced.map((_, j) => j * t.cardStepMs));
          revealEnd = e.replaced.length ? (e.replaced.length - 1) * t.cardStepMs + t.flipMs : 0;
          break;
        case "hold":
          this.sfx.hold(e.held);
          break;
        case "win": {
          // The count-up (anim.ts) starts when the drawn cards are face up.
          this.sfx.payout({
            atMs: revealEnd,
            durMs: countUpMs(this.anim.speed, e.amount),
            amount: e.amount,
            bet: this.state.bet,
            big: e.amount >= 50 * this.state.bet,
            top: e.category === 0,
          });
          break;
        }
        case "rejected":
          this.sfx.buzz();
          break;
      }
    }
  }

  /** Schedule a redraw; keeps animating while something moves. */
  request() {
    if (this.frame) return;
    this.frame = requestAnimationFrame((t) => this.draw(t));
  }

  draw(now: number) {
    this.frame = 0;
    this.view.state = this.state;
    this.view.trainer = {
      mode: this.mode(),
      tag: this.tag(),
      feedback: this.trainer?.feedback ?? null,
      lesson: this.trainer?.lesson ?? null,
    };
    const t0 = performance.now();
    drawCabinet(this.pix, this.view, this.anim, now);
    this.overlay?.(this.pix);
    const ms = performance.now() - t0;
    const f = this.frameStats;
    f.last = ms;
    f.worst = Math.max(f.worst, ms);
    f.total += ms;
    f.frames++;
    if (this.pendingInputAt !== null) {
      this.lastInputToFrameMs = performance.now() - this.pendingInputAt;
      this.pendingInputAt = null;
    }
    if (this.anim.busy(now)) this.request();
  }
}
