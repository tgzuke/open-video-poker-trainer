import { describe, expect, it } from "vitest";
import { CustomTables, type KeyValueStore } from "../src/customTables";

class MemStore implements KeyValueStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const base = {
  id: "jacks-or-better-9-6",
  game: "jacks-or-better",
  name: "9/6",
  pays: { full_house: 9, flush: 6 },
  max_bet_pays: { royal_flush: 4000 },
};

describe("custom pay tables", () => {
  it("saves, lists, replaces by name and removes", () => {
    const store = new MemStore();
    const ct = new CustomTables(store);
    const t = ct.save(base, "My 8/5", { full_house: 8, flush: 5 });
    expect(t.id).toBe("custom:jacks-or-better:my-8-5");
    expect(t.pays).toEqual({ full_house: 8, flush: 5 });
    expect(t.max_bet_pays).toEqual({ royal_flush: 4000 });
    // Persisted: a fresh instance on the same store sees it.
    expect(new CustomTables(store).list()).toHaveLength(1);
    ct.save(base, "my 8/5", { full_house: 7 });
    expect(ct.list()).toHaveLength(1);
    expect(ct.list()[0].pays.full_house).toBe(7);
    ct.remove(t.id);
    expect(ct.list()).toHaveLength(0);
  });

  it("rejects bad pays and survives corrupt storage", () => {
    const store = new MemStore();
    const ct = new CustomTables(store);
    expect(() => ct.save(base, "x", { flush: -1 })).toThrow();
    expect(() => ct.save(base, "x", { flush: 2.5 })).toThrow();
    store.setItem("ovp.customPaytables.v1", "{not json");
    expect(ct.list()).toEqual([]);
  });
});
