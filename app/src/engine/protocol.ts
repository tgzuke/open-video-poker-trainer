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
  | ({ kind: "optimalReturn" } & WagerMsg);

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

export type ResponseData =
  | { kind: "catalog"; catalog: Catalog }
  | { kind: "load"; buildMs: number; rebuilt: boolean }
  | { kind: "loadCustom"; buildMs: number; rebuilt: boolean }
  | { kind: "holdEvs"; result: HoldEvsResult; ms: number }
  | { kind: "optimalReturn"; ret: number; ms: number };

export interface Envelope<T> {
  id: number;
  body: T;
}

export type WorkerReply = Envelope<{ ok: true; data: ResponseData } | { ok: false; error: string }>;
