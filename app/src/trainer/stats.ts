// Trainer statistics (SPEC §5.4). All EV figures in credits. Pure data and
// updates; persistence lives in store.ts.
import type { DealCheck } from "../engine/protocol";
import { samePlay } from "./grade";

export interface RuleTally {
  opportunities: number;
  misses: number;
}

export interface Agg {
  version: 1;
  /** When this record started (ms since epoch). */
  since: number;
  hands: number;
  wagered: number;
  won: number;
  /** Final hands by pay line name ("No win" for losers). */
  results: Record<string, number>;
  /** (1) player vs optimal, summed over hands. */
  lossVsOptimal: number;
  /** (2) player vs strategy (negative when the player beat it). */
  lossVsStrategy: number;
  /** (3) strategy vs optimal: the strategy's built-in cost. */
  strategyLoss: number;
  /** Hands that had a strategy to compare against ((2), (3), deviations). */
  strategyHands: number;
  deviations: number;
  /** Rule distance histogram: "0", "1", "2", "3", "4+", "off". */
  distance: Record<string, number>;
  /** Per strategy ("paytable/tier"), per rule text. */
  rules: Record<string, Record<string, RuleTally>>;
}

export const DISTANCE_KEYS = ["0", "1", "2", "3", "4+", "off"] as const;

export function emptyAgg(now = Date.now()): Agg {
  return {
    version: 1,
    since: now,
    hands: 0,
    wagered: 0,
    won: 0,
    results: {},
    lossVsOptimal: 0,
    lossVsStrategy: 0,
    strategyLoss: 0,
    strategyHands: 0,
    deviations: 0,
    distance: Object.fromEntries(DISTANCE_KEYS.map((k) => [k, 0])),
    rules: {},
  };
}

export function distanceKey(d: number | null): (typeof DISTANCE_KEYS)[number] {
  if (d === null) return "off";
  return d >= 4 ? "4+" : (String(d) as "0" | "1" | "2" | "3");
}

/** One finished hand. */
export interface HandRecord {
  bet: number;
  won: number;
  result: string;
  check: DealCheck;
  /** The player's (first) hold. */
  hold: number;
  /** "paytable/tier" of the strategy in the check, if any. */
  strategyKey: string | null;
}

export function record(a: Agg, r: HandRecord): Agg {
  const c = r.check;
  a.hands++;
  a.wagered += r.bet;
  a.won += r.won;
  a.results[r.result] = (a.results[r.result] ?? 0) + 1;
  const evPlayer = c.evs[r.hold];
  a.lossVsOptimal += c.evs[c.best] - evPlayer;
  const s = c.strategy;
  if (s && r.strategyKey) {
    const evStrategy = c.evs[s.hold];
    a.strategyHands++;
    a.lossVsStrategy += evStrategy - evPlayer;
    a.strategyLoss += c.evs[c.best] - evStrategy;
    const deviated = !samePlay(c, r.hold, s.hold);
    if (deviated) a.deviations++;
    const k = distanceKey(s.distance[r.hold]);
    a.distance[k] = (a.distance[k] ?? 0) + 1;
    if (s.ruleText !== null) {
      const book = (a.rules[r.strategyKey] ??= {});
      const t = (book[s.ruleText] ??= { opportunities: 0, misses: 0 });
      t.opportunities++;
      if (deviated) t.misses++;
    }
  }
  return a;
}

/** Validates a stored record (anything malformed starts fresh). */
export function reviveAgg(x: unknown): Agg | null {
  if (typeof x !== "object" || x === null) return null;
  const a = x as Partial<Agg>;
  const nums: (keyof Agg)[] = ["since", "hands", "wagered", "won", "lossVsOptimal", "lossVsStrategy", "strategyLoss", "strategyHands", "deviations"];
  if (a.version !== 1 || nums.some((k) => typeof a[k] !== "number")) return null;
  if (typeof a.results !== "object" || typeof a.distance !== "object" || typeof a.rules !== "object") return null;
  return { ...emptyAgg(a.since), ...a } as Agg;
}

export interface StatsBook {
  session: Agg;
  lifetime: Agg;
}
