// Game model: a pure state machine. Actions apply immediately and return
// the new state plus events; animation and sound are driven by the events
// and never gate input (SPEC §6.3).
//
// Built for later formats without implementing them (CLAUDE.md):
// - `hands` is a list (multi-play deals several hands from one dealt hand);
// - `carry` holds state that persists between deals (e.g. Ultimate X
//   multipliers). Single-hand Free Play uses one hand and no carry.

import type { GameAction } from "../input/actions";

/** What the model needs to know about the game (backed by the wasm Rules). */
export interface Rules {
  maxBet: number;
  deckSize: number;
  noWin: number;
  /** Outcome category (pay line index, or noWin) of five card ids. */
  category(cards: number[]): number;
  /** Credits paid per category at this bet (progressive already applied). */
  pays(bet: number): number[];
}

/** Uniform integer in [0, n). */
export type Rng = (n: number) => number;

export interface Hand {
  cards: number[];
  held: boolean[];
  /** Category of the final hand, once drawn. */
  category: number | null;
  win: number;
}

export type Phase = "ready" | "dealt";

export interface GameState {
  phase: Phase;
  credits: number;
  bet: number;
  hands: Hand[];
  /** Undealt cards of the current deal, in order. */
  stock: number[];
  /** Category of the dealt (pre-draw) hand, for the pay table highlight. */
  dealtCategory: number | null;
  lastWin: number;
  handsPlayed: number;
  /** State carried between deals by future formats. Unused in v1. */
  carry: Record<string, unknown>;
}

export type GameEvent =
  | { type: "bet"; bet: number }
  | { type: "deal"; cards: number[] }
  | { type: "hold"; index: number; held: boolean }
  | { type: "draw"; replaced: number[] }
  | { type: "win"; category: number; amount: number; creditsBefore: number }
  | { type: "lose" }
  | { type: "refill"; credits: number }
  | { type: "rejected"; action: GameAction["type"]; reason: string };

export interface Options {
  startingCredits: number;
  autoRefill: boolean;
}

export function initialState(credits: number, bet = 1): GameState {
  return {
    phase: "ready",
    credits,
    bet,
    hands: [],
    stock: [],
    dealtCategory: null,
    lastWin: 0,
    handsPlayed: 0,
    carry: {},
  };
}

/** Fisher–Yates shuffle of 0..n-1. */
export function shuffledDeck(n: number, rng: Rng): number[] {
  const d = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Unbiased crypto RNG for play. */
export const cryptoRng: Rng = (n) => {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
};

export interface Step {
  state: GameState;
  events: GameEvent[];
}

export function apply(s: GameState, a: GameAction, rules: Rules, rng: Rng, opt: Options): Step {
  const reject = (reason: string): Step => ({ state: s, events: [{ type: "rejected", action: a.type, reason }] });
  switch (a.type) {
    case "betOne": {
      if (s.phase !== "ready") return reject("hand in progress");
      const bet = (s.bet % rules.maxBet) + 1;
      return { state: { ...s, bet }, events: [{ type: "bet", bet }] };
    }
    case "betMax": {
      if (s.phase !== "ready") return reject("hand in progress");
      const withBet = { ...s, bet: rules.maxBet };
      const dealt = deal(withBet, rules, rng, opt);
      return { state: dealt.state, events: [{ type: "bet", bet: rules.maxBet }, ...dealt.events] };
    }
    case "dealDraw":
      return s.phase === "ready" ? deal(s, rules, rng, opt) : draw(s, rules);
    case "hold": {
      if (s.phase !== "dealt") return reject("no hand dealt");
      if (a.index < 0 || a.index > 4) return reject("bad card");
      const h = s.hands[0];
      const held = h.held.slice();
      held[a.index] = !held[a.index];
      return {
        state: { ...s, hands: [{ ...h, held }] },
        events: [{ type: "hold", index: a.index, held: held[a.index] }],
      };
    }
  }
}

function deal(s: GameState, rules: Rules, rng: Rng, opt: Options): Step {
  const events: GameEvent[] = [];
  let credits = s.credits;
  if (credits < s.bet) {
    if (!opt.autoRefill) return { state: s, events: [{ type: "rejected", action: "dealDraw", reason: "not enough credits" }] };
    credits = opt.startingCredits;
    events.push({ type: "refill", credits });
  }
  const deck = shuffledDeck(rules.deckSize, rng);
  const cards = deck.slice(0, 5);
  const hand: Hand = { cards, held: [false, false, false, false, false], category: null, win: 0 };
  const cat = rules.category(cards);
  events.push({ type: "deal", cards });
  return {
    state: {
      ...s,
      phase: "dealt",
      credits: credits - s.bet,
      hands: [hand],
      stock: deck.slice(5),
      dealtCategory: cat === rules.noWin ? null : cat,
      lastWin: 0,
    },
    events,
  };
}

function draw(s: GameState, rules: Rules): Step {
  const h = s.hands[0];
  const stock = s.stock.slice();
  const replaced: number[] = [];
  const cards = h.cards.map((c, i) => {
    if (h.held[i]) return c;
    replaced.push(i);
    return stock.shift()!;
  });
  const category = rules.category(cards);
  const win = rules.pays(s.bet)[category] ?? 0;
  const events: GameEvent[] = [{ type: "draw", replaced }];
  events.push(win > 0 ? { type: "win", category, amount: win, creditsBefore: s.credits } : { type: "lose" });
  return {
    state: {
      ...s,
      phase: "ready",
      credits: s.credits + win,
      hands: [{ ...h, cards, category, win }],
      stock,
      dealtCategory: null,
      lastWin: win,
      handsPlayed: s.handsPlayed + 1,
    },
    events,
  };
}
