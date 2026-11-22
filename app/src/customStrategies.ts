// The player's own strategies (made in the strategy editor), one per pay
// table, stored locally. Saved as strategy file text (docs/strategy-format.md)
// with a header like the generated files, so they export and load anywhere.
import type { KeyValueStore } from "./customTables";
import type { StrategyReport } from "./engine/protocol";

const KEY = "ovp.customStrategies.v1";

export interface CustomStrategy {
  text: string;
  /** ms since epoch. */
  saved: number;
}

/** Strategy file text for a custom strategy: header comments with its
 *  numbers, then one rule per line. */
export function customStrategyText(
  rules: string[],
  meta: { game: string; paytable: string; bet: number; progressive: number | null },
  report: StrategyReport,
): string {
  const pct = (x: number) => `${(x * 100).toFixed(6)}%`;
  const head = [
    "# Open Video Poker Trainer strategy (custom; made in the strategy editor)",
    `# game: ${meta.game}`,
    `# paytable: ${meta.paytable}`,
    `# bet: ${meta.bet}`,
    ...(meta.progressive !== null ? [`# progressive: ${meta.progressive}`] : []),
    "# tier: custom",
    `# return: ${pct(report.return)}  optimal: ${pct(report.optimal)}`,
    `# loss: ${report.lossCredits.toFixed(6)} credits/hand (${report.lossPoints.toFixed(6)} points of return)`,
    `# complete: ${report.complete ? "yes" : "NO"}`,
    "#",
  ];
  return [...head, ...rules].join("\n") + "\n";
}

export class CustomStrategies {
  constructor(private readonly store: KeyValueStore) {}

  private all(): Record<string, CustomStrategy> {
    try {
      const raw: unknown = JSON.parse(this.store.getItem(KEY) ?? "{}");
      if (typeof raw !== "object" || raw === null) return {};
      return Object.fromEntries(
        Object.entries(raw).filter(
          ([, v]) => typeof v === "object" && v !== null && typeof v.text === "string" && typeof v.saved === "number",
        ),
      ) as Record<string, CustomStrategy>;
    } catch {
      return {};
    }
  }

  get(paytableId: string): CustomStrategy | null {
    return this.all()[paytableId] ?? null;
  }

  has(paytableId: string): boolean {
    return this.get(paytableId) !== null;
  }

  save(paytableId: string, text: string): void {
    this.store.setItem(KEY, JSON.stringify({ ...this.all(), [paytableId]: { text, saved: Date.now() } }));
  }

  remove(paytableId: string): void {
    const all = this.all();
    delete all[paytableId];
    this.store.setItem(KEY, JSON.stringify(all));
  }
}
