// Messages between the UI thread and the engine worker.

export type Request =
  | { kind: "load"; paytableId: string }
  | { kind: "holdEvs"; hand: string; bet: number }
  | { kind: "optimalReturn"; bet: number };

export interface HoldEvsResult {
  cards: string[]; // card names in dealt order
  evs: number[]; // 32 entries; bit i of the index keeps card i
  best: number; // mask of the highest-EV hold
}

export type ResponseData =
  | { kind: "load"; buildMs: number }
  | { kind: "holdEvs"; result: HoldEvsResult; ms: number }
  | { kind: "optimalReturn"; ret: number; ms: number };

export interface Envelope<T> {
  id: number;
  body: T;
}

export type WorkerReply = Envelope<{ ok: true; data: ResponseData } | { ok: false; error: string }>;
