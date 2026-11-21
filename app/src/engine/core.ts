// Request handling shared by the worker and tests; no DOM, no worker globals.
import type { Engine } from "../wasm/ovp_engine.js";
import type { HoldEvsResult, Request, ResponseData } from "./protocol";

export function bestHold(evs: ArrayLike<number>): number {
  let best = 0;
  for (let m = 1; m < evs.length; m++) if (evs[m] > evs[best]) best = m;
  return best;
}

export function holdEvs(engine: Engine, hand: string, bet: number): HoldEvsResult {
  const cards = engine.parseHand(hand);
  const evs = Array.from(engine.holdEvs(cards, bet));
  return { cards: Array.from(cards, (c) => engine.cardName(c)), evs, best: bestHold(evs) };
}

export class EngineHost {
  private engine: Engine | null = null;
  constructor(private readonly make: (paytableId: string) => Engine) {}

  handle(req: Request): ResponseData {
    const t0 = performance.now();
    if (req.kind === "load") {
      this.engine?.free();
      this.engine = this.make(req.paytableId);
      return { kind: "load", buildMs: performance.now() - t0 };
    }
    const engine = this.engine;
    if (!engine) throw new Error("engine not loaded");
    switch (req.kind) {
      case "holdEvs":
        return { kind: "holdEvs", result: holdEvs(engine, req.hand, req.bet), ms: performance.now() - t0 };
      case "optimalReturn":
        return { kind: "optimalReturn", ret: engine.optimalReturn(req.bet), ms: performance.now() - t0 };
    }
  }
}
