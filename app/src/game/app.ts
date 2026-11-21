// The playable game: input → model → animation/sound → renderer.
import { AUTO_REFILL, countUpMs, SPEED_TABLE, STARTING_CREDITS } from "../config/feel";
import { buttonToAction, type ButtonId } from "../input/actions";
import { Anim } from "../render/anim";
import { drawCabinet, type CabinetView } from "../render/cabinet";
import { Pix } from "../render/pix";
import { Sfx } from "../audio/sfx";
import type { Rules as WasmRules } from "../wasm/ovp_engine.js";
import { apply, cryptoRng, initialState, type GameEvent, type GameState, type Rng, type Rules } from "./model";
import { modelRules, payGrid } from "./rules";

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
    };
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

  setSpeed(speed: number) {
    this.anim.speed = speed;
  }

  setCredits(credits: number) {
    this.state = { ...this.state, credits };
    this.onChange(this.state);
    this.request();
  }

  press(b: ButtonId) {
    const now = performance.now();
    this.pendingInputAt = now;
    const { state, events } = apply(this.state, buttonToAction(b), this.rules, this.rng, {
      startingCredits: STARTING_CREDITS,
      autoRefill: AUTO_REFILL,
    });
    if (events.some((e) => e.type === "deal")) this.anim.clearFlash();
    this.state = state;
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
          this.sfx.bet();
          break;
        case "deal":
          this.sfx.cards([0, 1, 2, 3, 4].map((i) => i * t.cardStepMs));
          revealEnd = 4 * t.cardStepMs + t.flipMs;
          break;
        case "draw":
          this.sfx.cards(e.replaced.map((_, j) => j * t.cardStepMs));
          revealEnd = e.replaced.length ? (e.replaced.length - 1) * t.cardStepMs + t.flipMs : 0;
          break;
        case "hold":
          this.sfx.hold(e.held);
          break;
        case "win": {
          const big = e.amount >= 50 * this.state.bet;
          this.sfx.win(revealEnd, big);
          const dur = countUpMs(this.anim.speed, e.amount);
          if (dur > 0) this.sfx.countUp(revealEnd + 200, dur);
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
    drawCabinet(this.pix, this.view, this.anim, now);
    if (this.pendingInputAt !== null) {
      this.lastInputToFrameMs = performance.now() - this.pendingInputAt;
      this.pendingInputAt = null;
    }
    if (this.anim.busy(now)) this.request();
  }
}
