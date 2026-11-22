// Trainer controller (SPEC §5.2): asks the engine to check each dealt hand,
// gates the draw in Lesson mode, fills the Practice feedback box, and
// records stats for every hand in every mode.
//
// The engine check runs in the worker and normally arrives long before the
// player draws. If the player draws first: Free Play and Practice never
// wait; Lesson waits for the check (it has to judge the hold).
import { LESSON_TEXT, type Checking, type Mode } from "../config/trainer";
import type { DealCheck } from "../engine/protocol";
import { gradeHold, graceAt, heldMask, samePlay, type Color, type Grade } from "./grade";
import type { HandRecord } from "./stats";

export interface TrainerSettings {
  mode: Mode;
  checking: Checking;
  /** Pure EV grace at max bet, credits. */
  grace: number;
  maxBet: number;
}

export interface CheckResult {
  check: DealCheck;
  /** "paytable/tier" of the strategy the check used, or null. */
  strategyKey: string | null;
}

export type CheckProvider = (cards: number[], bet: number) => Promise<CheckResult>;

export type Gate = "allow" | "wait" | "block";

export interface Feedback {
  color: Color;
  title: string;
  /** Rule behind the expected play, if any. */
  rule: string | null;
  /** Credits given up (0 when correct). */
  cost: number;
}

export interface LessonPrompt {
  message: string;
  /** Cards to mark (third mistake), as a hold mask. */
  hint: number | null;
}

interface Current {
  id: number;
  bet: number;
  result: CheckResult | null;
  /** The player's first submitted hold (what stats judge). */
  firstHold: number | null;
  mistakes: number;
  final: { won: number; result: string } | null;
  recorded: boolean;
}

export function feedbackFor(g: Grade): Feedback {
  const title = g.correct ? "CORRECT" : g.distance === null ? "OFF STRATEGY" : g.color === "yellow" ? "CLOSE" : "WRONG";
  return { color: g.color, title, rule: g.expectedRule, cost: g.correct ? 0 : g.cost };
}

export class Trainer {
  feedback: Feedback | null = null;
  lesson: LessonPrompt | null = null;
  /** Called when a check arrives or the view changes. */
  onChange: () => void = () => {};
  private cur: Current | null = null;
  private nextId = 1;

  constructor(
    private provider: CheckProvider,
    private settings: () => TrainerSettings,
    private sink: (r: HandRecord) => void,
  ) {}

  get checkReady(): boolean {
    return this.cur?.result != null;
  }

  dealt(cards: number[], bet: number) {
    const id = this.nextId++;
    this.cur = { id, bet, result: null, firstHold: null, mistakes: 0, final: null, recorded: false };
    this.lesson = null;
    this.provider(cards, bet).then(
      (r) => {
        if (this.cur?.id !== id) return;
        this.cur.result = r;
        this.finish();
        this.onChange();
      },
      () => {
        /* no check (e.g. engine error): this hand isn't graded */
      },
    );
  }

  /** Called when the player presses Draw with these holds. */
  gate(held: boolean[]): Gate {
    const c = this.cur;
    if (!c || c.final) return "allow";
    const s = this.settings();
    const mask = heldMask(held);
    if (s.mode !== "lesson") {
      c.firstHold ??= mask;
      return "allow";
    }
    if (!c.result) return "wait";
    c.firstHold ??= mask;
    const check = c.result.check;
    const g = gradeHold(check, mask, s.checking, graceAt(s.grace, c.bet, s.maxBet));
    // After the hold has been shown, the player must enter that hold.
    const ok = c.mistakes >= 3 ? samePlay(check, mask, g.expected) : g.correct;
    if (ok) {
      this.lesson = null;
      return "allow";
    }
    c.mistakes++;
    if (c.mistakes === 2 && g.expectedRule === null) c.mistakes = 3; // no rule name to show
    this.lesson =
      c.mistakes === 1
        ? { message: LESSON_TEXT.first, hint: null }
        : c.mistakes === 2
          ? { message: LESSON_TEXT.rule(g.expectedRule!.toUpperCase()), hint: null }
          : { message: LESSON_TEXT.hold, hint: g.expected };
    this.onChange();
    return "block";
  }

  /** Called after the draw with the final hand's result. */
  drawn(won: number, result: string) {
    const c = this.cur;
    if (!c) return;
    c.final = { won, result };
    this.lesson = null;
    this.finish();
  }

  private finish() {
    const c = this.cur;
    if (!c || !c.result || !c.final || c.recorded || c.firstHold === null) return;
    c.recorded = true;
    const s = this.settings();
    const g = gradeHold(c.result.check, c.firstHold, s.checking, graceAt(s.grace, c.bet, s.maxBet));
    this.feedback = s.mode === "practice" ? feedbackFor(g) : null;
    this.sink({
      bet: c.bet,
      won: c.final.won,
      result: c.final.result,
      check: c.result.check,
      hold: c.firstHold,
      strategyKey: c.result.strategyKey,
    });
  }

  /** Mode switches clear what the old mode was showing. */
  modeChanged() {
    this.feedback = null;
    this.lesson = null;
  }
}
