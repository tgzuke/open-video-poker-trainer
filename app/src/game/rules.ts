// Adapts the wasm Rules (hand categories, pays) to the game model.
import type { Rules as WasmRules } from "../wasm/ovp_engine.js";
import type { Rules } from "./model";

export function modelRules(w: WasmRules, progressive: number | null): Rules {
  const maxBet = w.maxBet();
  const pays: number[][] = [];
  for (let b = 1; b <= maxBet; b++) pays[b] = Array.from(w.pays(b, progressive ?? undefined));
  return {
    maxBet,
    deckSize: w.deckSize(),
    noWin: w.noWin(),
    category: (cards) => w.category(Uint8Array.from(cards)),
    pays: (bet) => pays[bet],
  };
}

/** payGrid[line][bet-1], for the pay table display. */
export function payGrid(rules: Rules, lines: number): number[][] {
  return Array.from({ length: lines }, (_, l) => Array.from({ length: rules.maxBet }, (_, b) => rules.pays(b + 1)[l]));
}
