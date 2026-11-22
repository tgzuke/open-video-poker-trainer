// Pay table comparison screen (SPEC §4.5), outside the game flow: how the
// strategy for pay table B differs from the one for pay table A (rules
// added, removed or moved) and what each change is worth playing table B.
// The numbers come from the engine (`strategy::compare`), exact, at max bet.
import type { EngineClient } from "../engine/client";
import { LEVELS, type Comparison, type GameJson, type Level, type PayTableJson } from "../engine/protocol";
import { Latest } from "../editor/live";
import { ruleDisplay } from "../trainer/ruleText";
import { DEFAULT_TIER, LEVEL_NAMES } from "../config/trainer";
import { cardsHtml, esc, signed } from "./html";

export interface CompareHost {
  /** The tools worker, loaded with this pay table. */
  engine(table: PayTableJson): Promise<EngineClient>;
  games(): GameJson[];
  gameLabel(gameId: string): string;
  tables(): PayTableJson[];
  currentTable(): string;
  currentLevel(): Level;
  hasLevel(tableId: string, level: Level): boolean;
  loadLevel(tableId: string, level: Level): Promise<string>;
}

interface Side {
  table: string;
  level: Level;
}

const pct = (x: number, d = 4) => `${(x * 100).toFixed(d)}%`;

/** Default sides: A = the game's first preset (the full-pay version), B =
 *  the current table (or, if that is A, the game's next preset). */
export function defaultSides(tables: PayTableJson[], current: string, level: Level): [Side, Side] {
  const cur = tables.find((t) => t.id === current) ?? tables[0];
  const same = tables.filter((t) => t.game === cur.game && !t.id.startsWith("custom:"));
  const a = same[0] ?? cur;
  const b = cur.id !== a.id ? cur : (same[1] ?? cur);
  return [
    { table: a.id, level },
    { table: b.id, level },
  ];
}

export class CompareScreen {
  private a: Side = { table: "", level: "intermediate" };
  private b: Side = { table: "", level: "intermediate" };
  private result: { key: string; c: Comparison; ms: number } | null = null;
  private error: string | null = null;
  private live: Latest<{ c: Comparison; ms: number }>;

  constructor(
    private dlg: HTMLDialogElement,
    private host: CompareHost,
  ) {
    this.live = new Latest(
      async (key) => {
        const [a, b] = JSON.parse(key) as [Side, Side];
        const [ta, tb] = await Promise.all([host.loadLevel(a.table, a.level), host.loadLevel(b.table, b.level)]);
        if (!ta || !tb) throw new Error("no-strategy");
        const table = host.tables().find((t) => t.id === b.table)!;
        const game = host.games().find((g) => g.id === table.game)!;
        const engine = await host.engine(table);
        const res = await engine.request({ kind: "compareStrategies", a: ta, b: tb, bet: game.max_bet });
        return { c: res.comparison, ms: res.ms };
      },
      (key, r) => {
        this.result = { key, ...r };
        this.error = null;
        this.renderOut();
      },
      (_, e) => {
        this.error = e.message;
        this.renderOut();
      },
    );
  }

  get open() {
    return this.dlg.open;
  }

  show() {
    [this.a, this.b] = defaultSides(this.host.tables(), this.host.currentTable(), this.host.currentLevel());
    for (const s of [this.a, this.b]) if (!this.host.hasLevel(s.table, s.level)) s.level = this.firstLevel(s.table);
    this.render();
    this.dlg.showModal();
    this.run();
  }

  private firstLevel(table: string): Level {
    if (this.host.hasLevel(table, DEFAULT_TIER)) return DEFAULT_TIER;
    return LEVELS.find((l) => this.host.hasLevel(table, l)) ?? DEFAULT_TIER;
  }

  private key() {
    return JSON.stringify([this.a, this.b]);
  }

  private run() {
    this.error = null;
    this.live.request(this.key());
    this.renderOut();
  }

  private tableName(id: string): string {
    const t = this.host.tables().find((x) => x.id === id);
    return t ? `${this.host.gameLabel(t.game)} ${t.name}` : id;
  }

  private tableOptions(selected: string): string {
    return this.host
      .games()
      .map((g) => {
        const opts = this.host
          .tables()
          .filter((t) => t.game === g.id)
          .map((t) => `<option value="${esc(t.id)}" ${t.id === selected ? "selected" : ""}>${esc(this.host.gameLabel(g.id))} ${esc(t.name)}</option>`)
          .join("");
        return opts ? `<optgroup label="${esc(this.host.gameLabel(g.id))}">${opts}</optgroup>` : "";
      })
      .join("");
  }

  private levelOptions(s: Side): string {
    return LEVELS.map((l) => {
      const ok = this.host.hasLevel(s.table, l);
      return `<option value="${l}" ${l === s.level ? "selected" : ""} ${ok ? "" : "disabled"}>${LEVEL_NAMES[l]}${ok ? "" : " (none)"}</option>`;
    }).join("");
  }

  private render() {
    this.dlg.innerHTML = `
      <h2>COMPARE PAY TABLES</h2>
      <div class="note">How the strategy for pay table B differs from the one for pay table A, and what each difference is worth when you play B. Exact, at max bet.</div>
      <div class="toolbar">
        <label><b>A</b> <select id="c-a">${this.tableOptions(this.a.table)}</select></label><select id="c-la">${this.levelOptions(this.a)}</select>
        <button id="c-swap" title="Swap A and B">⇄</button>
        <label><b>B</b> <select id="c-b">${this.tableOptions(this.b.table)}</select></label><select id="c-lb">${this.levelOptions(this.b)}</select>
      </div>
      <div id="c-out"></div>
      <p><button id="c-close">Close (Esc)</button></p>`;
    const $ = <T extends HTMLElement>(id: string) => this.dlg.querySelector<T>(`#${id}`)!;
    const onTable = (s: Side, id: string) => {
      s.table = id;
      if (!this.host.hasLevel(s.table, s.level)) s.level = this.firstLevel(s.table);
      this.render();
      this.run();
    };
    $<HTMLSelectElement>("c-a").onchange = (e) => onTable(this.a, (e.target as HTMLSelectElement).value);
    $<HTMLSelectElement>("c-b").onchange = (e) => onTable(this.b, (e.target as HTMLSelectElement).value);
    $<HTMLSelectElement>("c-la").onchange = (e) => {
      this.a.level = (e.target as HTMLSelectElement).value as Level;
      this.run();
    };
    $<HTMLSelectElement>("c-lb").onchange = (e) => {
      this.b.level = (e.target as HTMLSelectElement).value as Level;
      this.run();
    };
    $("c-swap").onclick = () => {
      [this.a, this.b] = [this.b, this.a];
      this.render();
      this.run();
    };
    $("c-close").onclick = () => this.dlg.close();
    this.renderOut();
  }

  private renderOut() {
    const out = this.dlg.querySelector("#c-out");
    if (!out) return;
    if (this.error === "no-strategy") {
      out.innerHTML = `<p class="warn">One of these has no strategy at that level. Make one for a custom pay table in the strategy editor.</p>`;
      return;
    }
    if (this.error) {
      out.innerHTML = `<p class="warn">${esc(this.error)}</p>`;
      return;
    }
    const r = this.result;
    if (!r) {
      out.innerHTML = `<p class="note">Comparing…</p>`;
      return;
    }
    const stale = r.key !== this.key();
    out.innerHTML = `<div class="${stale ? "stale" : ""}">${stale ? `<p class="note">Comparing…</p>` : ""}${this.resultHtml(r.c, JSON.parse(r.key) as [Side, Side])}</div>`;
  }

  private resultHtml(c: Comparison, [a, b]: [Side, Side]): string {
    const nameA = `${this.tableName(a.table)} ${LEVEL_NAMES[a.level].toLowerCase()}`;
    const nameB = `${this.tableName(b.table)} ${LEVEL_NAMES[b.level].toLowerCase()}`;
    const tableB = this.tableName(b.table);
    const maxBet = this.host.games().find((g) => g.id === this.host.tables().find((t) => t.id === b.table)?.game)?.max_bet ?? 5;
    const cost = (c.bOnB - c.aOnB) * maxBet;
    const verdict =
      cost > 5e-7
        ? `Playing A's strategy on ${esc(tableB)} costs <b>${cost.toFixed(6)}</b> credits/hand.`
        : cost < -5e-7
          ? `<span class="warn">A's strategy does ${(-cost).toFixed(6)} credits/hand <i>better</i> on ${esc(tableB)} than B's own${
              a.level === b.level && a.level !== "custom" ? ": the generated list for B is not the best possible at this level" : ""
            }.</span>`
          : `The two strategies are worth the same on ${esc(tableB)}.`;
    const summary = `<table class="sum">
      <tr><td>Optimal play on ${esc(tableB)}</td><td class="num">${pct(c.optimalB)}</td></tr>
      <tr><td>B: ${esc(nameB)}</td><td class="num">${pct(c.bOnB)}</td></tr>
      <tr><td>A: ${esc(nameA)}, played on ${esc(tableB)}</td><td class="num">${pct(c.aOnB)}</td></tr>
      <tr><td>Hands played differently</td><td class="num">${pct(c.differ, 3)} of deals</td></tr>
      </table><p>${verdict}</p>`;

    const kindName = { added: "ADDED", removed: "REMOVED", moved: "MOVED" };
    const changes = c.changes.length
      ? `<table class="changes"><tr><th></th><th>Rule</th><th class="num">A line</th><th class="num">B line</th><th class="num">Effect, credits/hand</th><th class="num">Return points</th></tr>${c.changes
          .map(
            (ch) => `<tr><td><span class="kind ${ch.kind}">${kindName[ch.kind]}</span></td>
              <td title="${esc(ch.rule)}">${esc(ruleDisplay(ch.rule))}</td>
              <td class="num">${ch.from === null ? "—" : ch.from + 1}</td><td class="num">${ch.to === null ? "—" : ch.to + 1}</td>
              <td class="num ${ch.delta > 0 ? "good" : ch.delta < 0 ? "bad" : ""}">${signed(ch.delta * maxBet, 6)}</td>
              <td class="num">${signed(ch.delta * 100, 4)}</td></tr>`,
          )
          .join("")}
          <tr class="total"><td></td><td>Total</td><td></td><td></td><td class="num">${signed(cost, 6)}</td><td class="num">${signed((c.bOnB - c.aOnB) * 100, 4)}</td></tr></table>`
      : `<p class="note">The two lists are the same.</p>`;

    const diffs = c.differences.length
      ? `<table class="diffs"><tr><th class="num">Deals</th><th class="num">Effect</th><th>A plays by</th><th>B plays by</th><th>For example (A / B)</th><th class="num">B − A</th></tr>${c.differences
          .map(
            (d) => `<tr><td class="num">${pct(d.prob, 3)}</td><td class="num ${d.effect > 0 ? "good" : "bad"}">${signed(d.effect, 6)}</td>
              <td title="${esc(c.a[d.aRule])}">${d.aRule + 1}. ${esc(ruleDisplay(c.a[d.aRule]))}</td>
              <td title="${esc(c.b[d.bRule])}">${d.bRule + 1}. ${esc(ruleDisplay(c.b[d.bRule]))}</td>
              <td class="hands">${cardsHtml(d.hand, d.aHold)}<br>${cardsHtml(d.hand, d.bHold)}</td>
              <td class="num">${signed(d.gain, 4)}</td></tr>`,
          )
          .join("")}</table>${c.differenceCount > c.differences.length ? `<div class="note">Showing the ${c.differences.length} largest of ${c.differenceCount} groups.</div>` : ""}`
      : "";

    const mark = (side: "a" | "b") => {
      const m = new Map<number, string>();
      for (const ch of c.changes) {
        const i = side === "a" ? ch.from : ch.to;
        if (i !== null) m.set(i, ch.kind);
      }
      return m;
    };
    const list = (rules: string[], marks: Map<number, string>) =>
      `<ol>${rules.map((r, i) => `<li class="${marks.get(i) ?? ""}" title="${esc(r)}">${esc(ruleDisplay(r))}</li>`).join("")}</ol>`;

    return `${summary}
      <h4>Rule changes from A to B</h4>
      <div class="note">Applied to A's list from the top until it reads like B's. Each effect is what that change adds on ${esc(tableB)}, given the changes above it, so the effects add up to the total. A rule replaced by a reworded one shows as a removal and an addition that mostly cancel. Combined pat-hand lines are split into one line per hand first.</div>
      ${changes}
      ${diffs ? `<h4>Hands played differently, by deciding rule</h4><div class="note">Effect = what B's play gains over A's on these hands, credits per hand dealt; the example is the hand where the choice matters most (held cards bright).</div>${diffs}` : ""}
      <h4>The two lists</h4>
      <div class="lists"><div><b>A</b> ${esc(nameA)}${list(c.a, mark("a"))}</div><div><b>B</b> ${esc(nameB)}${list(c.b, mark("b"))}</div></div>
      <div class="note">${c.changes.length} changes · ${(this.result?.ms ?? 0).toFixed(0)} ms</div>`;
  }
}
