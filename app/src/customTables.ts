// Saved custom pay tables ("custom variants"), stored locally.
// Validation against the game happens in the engine when a table is loaded;
// this module only checks shape and persists.
import type { PayTableJson } from "./engine/protocol";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "ovp.customPaytables.v1";
const PREFIX = "custom:";

export function isPayTable(x: unknown): x is PayTableJson {
  if (typeof x !== "object" || x === null) return false;
  const t = x as Record<string, unknown>;
  const nums = (o: unknown) =>
    typeof o === "object" && o !== null && Object.values(o).every((v) => Number.isInteger(v) && (v as number) >= 0);
  return (
    typeof t.id === "string" &&
    typeof t.game === "string" &&
    typeof t.name === "string" &&
    nums(t.pays) &&
    (t.max_bet_pays === undefined || nums(t.max_bet_pays))
  );
}

export class CustomTables {
  constructor(private readonly store: KeyValueStore) {}

  list(): PayTableJson[] {
    try {
      const raw = this.store.getItem(KEY);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(isPayTable) : [];
    } catch {
      return [];
    }
  }

  /** Saves (or replaces by name within a game) a variant derived from `base`. */
  save(base: PayTableJson, name: string, pays: Record<string, number>): PayTableJson {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "table";
    const table: PayTableJson = {
      id: `${PREFIX}${base.game}:${slug}`,
      game: base.game,
      name: name.trim() || "Custom",
      pays: { ...base.pays, ...pays },
      max_bet_pays: { ...(base.max_bet_pays ?? {}) },
    };
    if (!isPayTable(table)) throw new Error("pays must be whole numbers ≥ 0");
    const rest = this.list().filter((t) => t.id !== table.id);
    this.store.setItem(KEY, JSON.stringify([...rest, table]));
    return table;
  }

  remove(id: string): void {
    this.store.setItem(KEY, JSON.stringify(this.list().filter((t) => t.id !== id)));
  }
}
