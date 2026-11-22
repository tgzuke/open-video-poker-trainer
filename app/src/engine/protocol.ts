// Messages between the UI thread and the engine worker.

/** What the player is wagering. `progressive` is the royal amount in whole
 *  credits; it only applies at max bet. */
export interface WagerMsg {
  bet: number;
  progressive?: number;
}

export type Request =
  | { kind: "catalog" }
  | { kind: "load"; paytableId: string }
  | { kind: "loadCustom"; paytable: PayTableJson }
  | ({ kind: "holdEvs"; hand: string } & WagerMsg)
  | ({ kind: "optimalReturn" } & WagerMsg)
  | ({ kind: "evaluateStrategy"; text: string } & WagerMsg)
  | ({ kind: "generateStrategy"; tier: Tier; seed: string; maxLines?: number } & WagerMsg)
  | { kind: "playStrategy"; text: string; hand: string }
  | { kind: "setTrainerStrategy"; text: string }
  | ({ kind: "dealCheck"; cards: number[] } & WagerMsg);

export type Tier = "beginner" | "intermediate" | "expert";
export const TIERS: Tier[] = ["beginner", "intermediate", "expert"];

export interface RuleReport {
  text: string;
  fires: number; // probability the rule decides the hand
  disagrees: number; // probability it decides and its hold is not optimal
  loss: number; // credits per hand lost on those hands
}
export interface StrategyReport {
  return: number;
  optimal: number;
  lossCredits: number;
  lossPoints: number;
  complete: boolean;
  undefined: string[];
  undefinedCount: number;
  ambiguous: string[];
  ambiguousCount: number;
  rules: RuleReport[];
}
export interface StrategyPlay {
  cards: string[];
  rule: number | null; // 0-based deciding rule
  hold: number; // mask, bit i keeps card i
  matching: { rule: number; hold: number }[]; // every matching rule, in order
}

export interface PayLineJson {
  id: string;
  name: string;
  hand: string;
}
export interface GameJson {
  id: string;
  name: string;
  label: string;
  max_bet: number;
  progressive_line?: string;
  lines: PayLineJson[];
}
export interface PayTableJson {
  id: string;
  game: string;
  name: string;
  pays: Record<string, number>;
  max_bet_pays?: Record<string, number>;
  published_return_pct?: number;
}
export interface Catalog {
  games: GameJson[];
  paytables: PayTableJson[];
}

export interface HoldEvsResult {
  cards: string[]; // card names in dealt order
  evs: number[]; // 32 entries; bit i of the index keeps card i
  best: number; // mask of the highest-EV hold
}

/** Trainer data for one dealt hand (engine `strategy::trainer`). Masks:
 *  bit i keeps card i. */
export interface DealCheck {
  evs: number[]; // 32 hold EVs, credits
  tie: number[]; // holds with equal tie[] have exactly equal EV
  best: number;
  strategy: null | {
    rule: number | null;
    ruleText: string | null;
    hold: number;
    matching: { rule: number; text: string; hold: number }[];
    describes: (number | null)[]; // first rule describing each hold
    distance: (number | null)[]; // rule distance per hold; null = off-strategy
  };
}

export type ResponseData =
  | { kind: "catalog"; catalog: Catalog }
  | { kind: "load"; buildMs: number; rebuilt: boolean }
  | { kind: "loadCustom"; buildMs: number; rebuilt: boolean }
  | { kind: "holdEvs"; result: HoldEvsResult; ms: number }
  | { kind: "optimalReturn"; ret: number; ms: number }
  | { kind: "evaluateStrategy"; report: StrategyReport; ms: number }
  | { kind: "generateStrategy"; text: string; ms: number }
  | { kind: "playStrategy"; play: StrategyPlay }
  | { kind: "setTrainerStrategy" }
  | { kind: "dealCheck"; check: DealCheck };

export interface Envelope<T> {
  id: number;
  body: T;
}

export type WorkerReply = Envelope<{ ok: true; data: ResponseData } | { ok: false; error: string }>;
