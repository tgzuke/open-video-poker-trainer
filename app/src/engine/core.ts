// Request handling shared by the worker and tests; no DOM, no worker globals.
import type { Engine } from "../wasm/ovp_engine.js";
import type { Catalog, HoldEvsResult, PayTableJson, Request, ResponseData, StrategyPlay, StrategyReport } from "./protocol";

/** The parts of the wasm module the host needs (injected for testability). */
export interface EngineModule {
  catalog(): string;
  builtin(paytableId: string): Engine;
}

export function bestHold(evs: ArrayLike<number>): number {
  let best = 0;
  for (let m = 1; m < evs.length; m++) if (evs[m] > evs[best]) best = m;
  return best;
}

export class EngineHost {
  private engine: Engine | null = null;
  private catalogCache: Catalog | null = null;
  constructor(private readonly mod: EngineModule) {}

  catalog(): Catalog {
    return (this.catalogCache ??= JSON.parse(this.mod.catalog()) as Catalog);
  }

  /** Point the engine at a pay table, rebuilding draw tables only when the
   *  game changes. */
  private select(table: PayTableJson, custom: boolean): boolean {
    let rebuilt = false;
    if (!this.engine || this.engine.gameId() !== table.game) {
      const preset = this.catalog().paytables.find((t) => t.game === table.game);
      if (!preset) throw new Error(`unknown game '${table.game}'`);
      this.engine?.free();
      this.engine = null;
      this.engine = this.mod.builtin(preset.id);
      rebuilt = true;
    }
    if (custom) this.engine.setCustomPaytable(JSON.stringify(table));
    else this.engine.setPaytable(table.id);
    return rebuilt;
  }

  handle(req: Request): ResponseData {
    const t0 = performance.now();
    switch (req.kind) {
      case "catalog":
        return { kind: "catalog", catalog: this.catalog() };
      case "load": {
        const table = this.catalog().paytables.find((t) => t.id === req.paytableId);
        if (!table) throw new Error(`unknown pay table '${req.paytableId}'`);
        const rebuilt = this.select(table, false);
        return { kind: "load", buildMs: performance.now() - t0, rebuilt };
      }
      case "loadCustom": {
        const rebuilt = this.select(req.paytable, true);
        return { kind: "loadCustom", buildMs: performance.now() - t0, rebuilt };
      }
    }
    const engine = this.engine;
    if (!engine) throw new Error("engine not loaded");
    switch (req.kind) {
      case "holdEvs": {
        const cards = engine.parseHand(req.hand);
        const evs = Array.from(engine.holdEvs(cards, req.bet, req.progressive));
        const result: HoldEvsResult = {
          cards: Array.from(cards, (c) => engine.cardName(c)),
          evs,
          best: bestHold(evs),
        };
        return { kind: "holdEvs", result, ms: performance.now() - t0 };
      }
      case "optimalReturn":
        return { kind: "optimalReturn", ret: engine.optimalReturn(req.bet, req.progressive), ms: performance.now() - t0 };
      case "evaluateStrategy": {
        const report = JSON.parse(engine.evaluateStrategy(req.text, req.bet, req.progressive)) as StrategyReport;
        return { kind: "evaluateStrategy", report, ms: performance.now() - t0 };
      }
      case "generateStrategy": {
        const text = engine.generateStrategy(req.tier, req.bet, req.progressive, req.seed, req.maxLines);
        return { kind: "generateStrategy", text, ms: performance.now() - t0 };
      }
      case "playStrategy": {
        const cards = engine.parseHand(req.hand);
        const raw = JSON.parse(engine.playStrategy(req.text, cards)) as Omit<StrategyPlay, "cards">;
        return { kind: "playStrategy", play: { ...raw, cards: Array.from(cards, (c) => engine.cardName(c)) } };
      }
    }
  }
}
