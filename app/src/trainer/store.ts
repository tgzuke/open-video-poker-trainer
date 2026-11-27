// Stats persistence in IndexedDB (SPEC §5.4, §7). Writes are batched off
// the input path. If IndexedDB is unavailable, stats live for the page only.
import { emptyAgg, migrateRuleTexts, record, reviveAgg, type HandRecord, type StatsBook } from "./stats";

export interface Kv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export class MemoryKv implements Kv {
  data = new Map<string, unknown>();
  async get(k: string) {
    return structuredClone(this.data.get(k));
  }
  async set(k: string, v: unknown) {
    this.data.set(k, structuredClone(v));
  }
}

const DB = "ovp";
const STORE = "stats";

export class IdbKv implements Kv {
  private db: Promise<IDBDatabase>;
  constructor(factory: IDBFactory) {
    this.db = new Promise((resolve, reject) => {
      const req = factory.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  private async run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const req = f(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  get(k: string) {
    return this.run("readonly", (s) => s.get(k));
  }
  async set(k: string, v: unknown) {
    await this.run("readwrite", (s) => s.put(v, k));
  }
}

export function defaultKv(): Kv {
  try {
    if (typeof indexedDB !== "undefined") return new IdbKv(indexedDB);
  } catch {
    /* fall through */
  }
  return new MemoryKv();
}

/** Session and lifetime stats with debounced saving. */
export class Stats {
  book: StatsBook = { session: emptyAgg(), lifetime: emptyAgg() };
  onChange: () => void = () => {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = new Set<keyof StatsBook>();

  constructor(
    private kv: Kv,
    private saveDelayMs = 250,
  ) {}

  /** Loads saved stats (call before play starts); a failed or malformed
   *  load starts fresh. Per-rule tallies of renamed shipped rules are
   *  carried over to the new wording. */
  async load(): Promise<void> {
    for (const k of ["session", "lifetime"] as const) {
      try {
        const v = reviveAgg(await this.kv.get(k));
        if (v) {
          this.book[k] = v;
          // Renamed rules of shipped lists keep their tallies.
          if (migrateRuleTexts(v)) this.markDirty(k);
        }
      } catch {
        /* keep fresh */
      }
    }
    this.onChange();
  }

  add(r: HandRecord) {
    record(this.book.session, r);
    record(this.book.lifetime, r);
    this.markDirty("session", "lifetime");
  }

  reset(which: keyof StatsBook) {
    this.book[which] = emptyAgg();
    this.markDirty(which);
  }

  /** Writes pending changes now. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const keys = [...this.dirty];
    this.dirty.clear();
    await Promise.all(keys.map((k) => this.kv.set(k, this.book[k]).catch(() => {})));
  }

  private markDirty(...keys: (keyof StatsBook)[]) {
    keys.forEach((k) => this.dirty.add(k));
    this.onChange();
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.saveDelayMs);
  }
}
