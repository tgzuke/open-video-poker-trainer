// Strategy editor (SPEC §4.4), a mouse-driven dialog: reorder (drag or
// arrows), add, remove and edit rules of a strategy for the current pay
// table. The exact evaluator reruns in the tools worker after every change
// and shows the return, the EV loss against optimal play, what the last
// edit changed, and any hands the strategy leaves ambiguous.
import type { EngineClient } from "../engine/client";
import { LEVELS, TIERS, type Level, type PayTableJson, type StrategyReport, type Tier } from "../engine/protocol";
import { customStrategyText } from "../customStrategies";
import { EditorModel, type RuleParser } from "../editor/model";
import { Latest } from "../editor/live";
import { ruleDisplay } from "../trainer/ruleText";
import { LEVEL_NAMES } from "../config/trainer";
import { cardsHtml, download, esc, signed } from "./html";

export interface EditorHost {
  /** The tools worker, loaded with this pay table. */
  engine(table: PayTableJson): Promise<EngineClient>;
  /** Stop the tools worker (cancels a generation); a new one starts on
   *  the next request. */
  cancelEngine(): void;
  table(): PayTableJson;
  tableLabel(): string;
  maxBet(): number;
  progressive(): number | null;
  /** The trainer's current level, and which levels exist for the table. */
  level(): Level;
  hasLevel(l: Level): boolean;
  loadLevel(l: Level): Promise<string>;
  suggestions(): Promise<string[]>;
  parseRule: RuleParser;
  /** Save as the player's strategy for the table; `train` also selects it
   *  for the trainer. */
  saveCustom(text: string, train: boolean): void;
}

const pct = (x: number, d = 4) => `${(x * 100).toFixed(d)}%`;

export class StrategyEditor {
  readonly model: EditorModel;
  private report: { text: string; r: StrategyReport } | null = null;
  /** Return at load time, and of the evaluation before the latest. */
  private baseReturn: number | null = null;
  private prevReturn: number | null = null;
  private evalError: string | null = null;
  private live: Latest<StrategyReport>;
  private generating: { tier: Tier; started: number; timer: number } | null = null;
  private notice = "";
  private confirmClose = false;
  private importing = false;
  private focus: number | null = null;
  private dragFrom: number | null = null;
  private source: Level = "intermediate";
  private suggest: string[] | null = null;

  constructor(
    private dlg: HTMLDialogElement,
    private host: EditorHost,
  ) {
    this.model = new EditorModel(host.parseRule);
    this.live = new Latest(
      async (text) => {
        const table = this.host.table();
        const engine = await this.host.engine(table);
        const res = await engine.request({
          kind: "evaluateStrategy",
          text,
          bet: this.host.maxBet(),
          progressive: this.host.progressive() ?? undefined,
        });
        return res.report;
      },
      (text, r) => {
        if (this.report && this.report.text !== text) this.prevReturn = this.report.r.return;
        this.report = { text, r };
        this.evalError = null;
        if (this.baseReturn === null) this.baseReturn = r.return;
        this.update();
      },
      (_, e) => {
        if (e.message !== "cancelled") this.evalError = e.message;
        this.update();
      },
    );
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.requestClose();
    });
  }

  get open() {
    return this.dlg.open;
  }

  async show() {
    this.source = this.host.hasLevel("custom") ? "custom" : this.host.level() === "custom" ? "intermediate" : this.host.level();
    this.notice = "";
    this.confirmClose = false;
    this.importing = false;
    this.model.load("");
    this.report = null;
    this.suggest = null;
    this.render();
    this.dlg.showModal();
    void this.host.suggestions().then((list) => {
      this.suggest = list;
      const dl = this.dlg.querySelector("#e-suggest");
      if (dl) dl.innerHTML = this.suggestHtml();
    });
    await this.loadLevel(this.source);
  }

  private async loadLevel(level: Level) {
    const text = await this.host.loadLevel(level);
    this.replace(text, true);
    this.notice = text ? "" : `No ${LEVEL_NAMES[level].toLowerCase()} strategy for this pay table yet: generate one, import one, or build from "discard everything" up.`;
    this.render();
  }

  /** New list: `fresh` (a load) resets undo; otherwise it is one undoable
   *  change. Either way the "since loaded" baseline restarts. */
  private replace(text: string, fresh: boolean) {
    if (fresh) this.model.load(text);
    else this.model.replaceAll(text);
    this.baseReturn = null;
    this.prevReturn = null;
    this.report = null;
    this.evaluate();
  }

  private evaluate() {
    if (this.model.valid()) this.live.request(this.model.text());
    else this.live.clear();
  }

  private changed(focus: number | null = null) {
    this.focus = focus;
    this.notice = "";
    this.evaluate();
    this.render();
  }

  private requestClose() {
    if (this.generating) return;
    if (this.model.dirty) {
      this.confirmClose = true;
      this.render();
    } else this.dlg.close();
  }

  // ---- rendering -------------------------------------------------------

  private fresh(): StrategyReport | null {
    return this.report && this.report.text === this.model.text() ? this.report.r : null;
  }

  /** Per-rule stats by rule text from the last evaluation (they may be
   *  stale; rows show them dimmed until the new run finishes). */
  private statsByRule() {
    const m = new Map<string, StrategyReport["rules"][number]>();
    for (const r of this.report?.r.rules ?? []) if (!m.has(r.text)) m.set(r.text, r);
    return m;
  }

  private summaryHtml(): string {
    const err = this.model.firstError();
    if (err) return `<span class="warn">Line ${err.line + 1}: ${esc(err.error)}. Fix it to evaluate.</span>`;
    if (this.evalError) return `<span class="warn">${esc(this.evalError)}</span>`;
    const r = this.fresh() ?? this.report?.r;
    if (!r) return `<span class="note">Evaluating…</span>`;
    const stale = !this.fresh();
    const deltas: string[] = [];
    if (!stale && this.prevReturn !== null) deltas.push(`last edit ${signed((r.return - this.prevReturn) * 100, 4)}`);
    if (!stale && this.baseReturn !== null && this.prevReturn !== null) deltas.push(`since loaded ${signed((r.return - this.baseReturn) * 100, 4)}`);
    const complete = r.complete
      ? `<span class="good">complete</span>`
      : `<span class="warn">${r.undefinedCount ? `${r.undefinedCount} hand classes no rule decides; ` : ""}${r.ambiguousCount ? `${r.ambiguousCount} ambiguous (the rule leaves holds of different EV tied), e.g. ${esc(r.ambiguous.slice(0, 3).join(", "))}` : ""}</span>`;
    return `<div class="${stale ? "stale" : ""}">
      <b>Return ${pct(r.return)}</b>${deltas.length ? ` <span class="delta">(${deltas.join(" · ")} points)</span>` : ""}
      · optimal ${pct(r.optimal)}
      · <b>EV loss ${r.lossCredits.toFixed(6)}</b> credits/hand
      · ${complete}
      ${stale ? `<span class="note"> · evaluating…</span>` : ""}</div>`;
  }

  private rowsHtml(): string {
    const stats = this.statsByRule();
    const stale = !this.fresh();
    const n = this.model.lines.length;
    return this.model.lines
      .map((l, i) => {
        const fixed = this.model.isFixed(i);
        const st = !l.error ? stats.get(l.text) : undefined;
        const nums = st
          ? `<td class="num">${(st.fires * 100).toFixed(3)}</td><td class="num">${(st.disagrees * 100).toFixed(3)}</td><td class="num ${st.loss > 5e-7 ? "costly" : ""}">${st.loss.toFixed(6)}</td>`
          : `<td class="num">—</td><td class="num">—</td><td class="num">—</td>`;
        const plain = l.error
          ? `<div class="plain warn">${esc(l.error)}</div>`
          : l.repeats !== null
            ? `<div class="plain warn">repeats line ${l.repeats + 1}: never decides a hand</div>`
            : ruleDisplay(l.text) !== l.text
              ? `<div class="plain">${esc(ruleDisplay(l.text))}</div>`
              : "";
        const input = fixed
          ? `<span class="fixedrule">${esc(l.text)}</span><div class="plain">always the last line</div>`
          : `<input data-edit="${i}" value="${esc(l.text)}" list="e-suggest" spellcheck="false" autocomplete="off" />${plain}`;
        const btns = fixed
          ? `<button data-add="${i}" title="Add a rule above this line">＋</button>`
          : `<button data-up="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>▲</button><button data-down="${i}" title="Move down" ${i >= n - 2 ? "disabled" : ""}>▼</button><button data-add="${i + 1}" title="Add a rule below">＋</button><button data-del="${i}" title="Remove">✕</button>`;
        return `<tr data-row="${i}" ${fixed ? "" : `draggable="true"`} class="${l.error ? "bad" : ""} ${stale ? "stale" : ""}">
          <td class="grip">${fixed ? "" : "⋮⋮"}</td><td class="num">${i + 1}</td><td class="rule">${input}</td>${nums}<td class="btns">${btns}</td></tr>`;
      })
      .join("");
  }

  private worstHtml(): string {
    const r = this.fresh();
    if (!r || !r.worst.length) return "";
    const rules = this.model.rules();
    const rows = r.worst
      .map(
        (w) =>
          `<tr><td>${cardsHtml(w.hand, w.hold)}</td><td title="${esc(rules[w.rule] ?? "")}">line ${w.rule + 1}</td><td>${cardsHtml(w.hand, w.best)}</td><td class="num">${w.loss.toFixed(7)}</td></tr>`,
      )
      .join("");
    return `<h4>Costliest misplays</h4><div class="note">Hand classes where the strategy's hold is not optimal, by EV lost per hand dealt (credits).</div>
      <table class="worst"><tr><th>Strategy holds</th><th>Rule</th><th>Optimal holds</th><th>Loss</th></tr>${rows}</table>`;
  }

  private suggestHtml(): string {
    return (this.suggest ?? []).map((r) => `<option value="${esc(r)}">`).join("");
  }

  private busyHtml(): string {
    if (this.generating) {
      const s = Math.floor((Date.now() - this.generating.started) / 1000);
      return `Generating a ${this.generating.tier} strategy for this pay table… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} (beginner takes about a minute, expert several) <button id="e-cancel">Cancel</button>`;
    }
    return esc(this.notice);
  }

  private render() {
    const h = this.host;
    const levels = LEVELS.map(
      (l) => `<option value="${l}" ${l === this.source ? "selected" : ""} ${h.hasLevel(l) ? "" : "disabled"}>${LEVEL_NAMES[l]}${h.hasLevel(l) ? "" : " (none)"}</option>`,
    ).join("");
    const tiers = TIERS.map((t) => `<option value="${t}" ${t === "beginner" ? "selected" : ""}>${LEVEL_NAMES[t]}</option>`).join("");
    const gen = !!this.generating;
    this.dlg.innerHTML = `
      <h2>STRATEGY EDITOR <span class="sub">${esc(h.tableLabel())} · max bet${h.progressive() !== null ? ` · progressive royal ${h.progressive()}` : ""}</span></h2>
      <div class="toolbar">
        <label>Start from <select id="e-level" ${gen ? "disabled" : ""}>${levels}</select></label><button id="e-load" ${gen ? "disabled" : ""}>Load</button>
        <span class="sep"></span>
        <label>Generate <select id="e-gen-tier" ${gen ? "disabled" : ""}>${tiers}</select></label>
        <label title="Line cap (3–200); empty = the tier's default">lines <input id="e-gen-lines" type="number" min="3" max="200" size="4" placeholder="auto" ${gen ? "disabled" : ""} /></label>
        <button id="e-gen" ${gen ? "disabled" : ""}>Generate</button>
        <span class="sep"></span>
        <button id="e-import" ${gen ? "disabled" : ""}>Import…</button><button id="e-export">Export</button>
        <span class="sep"></span>
        <button id="e-undo" ${this.model.canUndo && !gen ? "" : "disabled"}>Undo</button>
      </div>
      <div id="e-busy" class="note">${this.busyHtml()}</div>
      ${
        this.importing
          ? `<div class="import"><div class="note">Paste a strategy (one rule per line, notation as in docs/strategy-format.md; # starts a comment).</div>
             <textarea id="e-import-text" rows="8" spellcheck="false"></textarea>
             <div><button id="e-import-ok">Use these rules</button><button id="e-import-cancel">Cancel</button></div></div>`
          : ""
      }
      <div id="e-summary" class="summary">${this.summaryHtml()}</div>
      <div class="note">Rules are tried top to bottom; the first that describes some cards in the hand decides the hold. Drag rows or use ▲▼ to reorder; edit a rule in file notation (suggestions appear as you type). Fires = % of deals it decides; Not optimal = % where its hold isn't the best; Loss = EV given up, credits per hand dealt.</div>
      <table class="rules ${gen ? "locked" : ""}"><thead><tr><th></th><th>#</th><th>Rule</th><th class="num">Fires %</th><th class="num">Not optimal %</th><th class="num">Loss</th><th></th></tr></thead>
        <tbody>${this.rowsHtml()}</tbody></table>
      <datalist id="e-suggest">${this.suggestHtml()}</datalist>
      <div id="e-worst">${this.worstHtml()}</div>
      ${
        this.confirmClose
          ? `<div class="confirm">Unsaved changes. <button id="e-confirm-save">Save</button><button id="e-confirm-discard" class="danger">Discard</button><button id="e-confirm-keep">Keep editing</button></div>`
          : ""
      }
      <p class="actions">
        <button id="e-save" ${gen ? "disabled" : ""}>Save as my strategy</button>
        <button id="e-train" ${gen ? "disabled" : ""}>Save and train with it</button>
        <button id="e-close" ${gen ? "disabled" : ""}>Close (Esc)</button>
      </p>`;
    this.wire();
    if (this.focus !== null) {
      const el = this.dlg.querySelector<HTMLInputElement>(`[data-edit="${this.focus}"]`);
      el?.focus();
      el?.select();
      this.focus = null;
    }
  }

  /** Refresh numbers only (keeps focus and typing in inputs). */
  private update() {
    if (!this.open) return;
    const s = this.dlg.querySelector("#e-summary");
    if (s) s.innerHTML = this.summaryHtml();
    const body = this.dlg.querySelector("tbody");
    const active = document.activeElement as HTMLInputElement | null;
    const editing = active?.dataset?.edit !== undefined && body?.contains(active);
    if (body && !editing) {
      body.innerHTML = this.rowsHtml();
      this.wireRows();
    } else if (body) {
      // Don't disturb the input being typed in: refresh other rows' numbers.
      const fresh = document.createElement("tbody");
      fresh.innerHTML = this.rowsHtml();
      body.querySelectorAll<HTMLTableRowElement>("tr").forEach((tr, i) => {
        const src = fresh.children[i] as HTMLTableRowElement | undefined;
        if (!src) return;
        tr.className = src.className;
        for (const k of [3, 4, 5]) if (tr.cells[k] && src.cells[k]) tr.cells[k].outerHTML = src.cells[k].outerHTML;
      });
    }
    const w = this.dlg.querySelector("#e-worst");
    if (w) w.innerHTML = this.worstHtml();
    const b = this.dlg.querySelector("#e-busy");
    if (b && !this.generating) b.innerHTML = this.busyHtml();
  }

  // ---- events ----------------------------------------------------------

  private wireRows() {
    const q = <T extends HTMLElement>(sel: string) => this.dlg.querySelectorAll<T>(sel);
    q<HTMLInputElement>("[data-edit]").forEach((inp) => {
      inp.onchange = () => {
        const i = Number(inp.dataset.edit);
        this.model.edit(i, inp.value);
        this.changed();
      };
      inp.onkeydown = (e) => {
        if (e.key === "Enter") inp.blur();
      };
    });
    q<HTMLButtonElement>("[data-up]").forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.up);
        this.model.move(i, i - 1);
        this.changed();
      };
    });
    q<HTMLButtonElement>("[data-down]").forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.down);
        this.model.move(i, i + 1);
        this.changed();
      };
    });
    q<HTMLButtonElement>("[data-add]").forEach((b) => {
      b.onclick = () => this.changed(this.model.insert(Number(b.dataset.add)));
    });
    q<HTMLButtonElement>("[data-del]").forEach((b) => {
      b.onclick = () => {
        this.model.remove(Number(b.dataset.del));
        this.changed();
      };
    });
    q<HTMLTableRowElement>("tr[data-row]").forEach((tr) => {
      const i = Number(tr.dataset.row);
      tr.ondragstart = (e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return e.preventDefault();
        this.dragFrom = i;
        e.dataTransfer?.setData("text/plain", String(i));
        tr.classList.add("dragging");
      };
      tr.ondragend = () => {
        this.dragFrom = null;
        tr.classList.remove("dragging");
      };
      tr.ondragover = (e) => {
        if (this.dragFrom === null) return;
        e.preventDefault();
        q("tr.drop").forEach((x) => x.classList.remove("drop"));
        tr.classList.add("drop");
      };
      tr.ondrop = (e) => {
        e.preventDefault();
        if (this.dragFrom === null) return;
        this.model.move(this.dragFrom, i);
        this.dragFrom = null;
        this.changed();
      };
    });
  }

  private wire() {
    const $ = <T extends HTMLElement>(id: string) => this.dlg.querySelector<T>(`#${id}`);
    this.wireRows();
    $("e-load")!.onclick = () => {
      this.source = $<HTMLSelectElement>("e-level")!.value as Level;
      void this.loadLevel(this.source);
    };
    $("e-gen")!.onclick = () => {
      const tier = $<HTMLSelectElement>("e-gen-tier")!.value as Tier;
      const raw = $<HTMLInputElement>("e-gen-lines")!.value.trim();
      void this.generate(tier, raw ? Number(raw) : undefined);
    };
    $("e-cancel")?.addEventListener("click", () => this.cancelGenerate());
    $("e-import")!.onclick = () => {
      this.importing = true;
      this.render();
      $<HTMLTextAreaElement>("e-import-text")?.focus();
    };
    $("e-import-ok")?.addEventListener("click", () => {
      const text = $<HTMLTextAreaElement>("e-import-text")!.value;
      this.importing = false;
      this.replace(text, false);
      this.changed();
    });
    $("e-import-cancel")?.addEventListener("click", () => {
      this.importing = false;
      this.render();
    });
    $("e-export")!.onclick = () => void this.export();
    $("e-undo")!.onclick = () => {
      this.model.undo();
      this.changed();
    };
    $("e-save")!.onclick = () => void this.save(false);
    $("e-train")!.onclick = () => void this.save(true);
    $("e-close")!.onclick = () => this.requestClose();
    $("e-confirm-save")?.addEventListener("click", () => void this.save(false).then((ok) => ok && this.dlg.close()));
    $("e-confirm-discard")?.addEventListener("click", () => this.dlg.close());
    $("e-confirm-keep")?.addEventListener("click", () => {
      this.confirmClose = false;
      this.render();
    });
  }

  // ---- actions ---------------------------------------------------------

  /** A report for exactly the current list (waits for an evaluation). */
  private async currentReport(): Promise<StrategyReport | null> {
    if (!this.model.valid()) return null;
    const have = this.fresh();
    if (have) return have;
    const engine = await this.host.engine(this.host.table());
    const res = await engine.request({
      kind: "evaluateStrategy",
      text: this.model.text(),
      bet: this.host.maxBet(),
      progressive: this.host.progressive() ?? undefined,
    });
    return res.report;
  }

  private fileText(report: StrategyReport): string {
    const t = this.host.table();
    const rules = this.model.rules();
    return customStrategyText(rules, { game: t.game, paytable: t.id, bet: this.host.maxBet(), progressive: this.host.progressive() }, report);
  }

  private async save(train: boolean): Promise<boolean> {
    const err = this.model.firstError();
    if (err) {
      this.notice = `Can't save: line ${err.line + 1}: ${err.error}.`;
      this.render();
      return false;
    }
    const report = await this.currentReport();
    if (!report) return false;
    this.host.saveCustom(this.fileText(report), train);
    this.model.markSaved();
    this.confirmClose = false;
    this.source = "custom";
    this.notice = `Saved as your strategy for this pay table${train ? "; the trainer now checks your play against it" : ""}.${report.complete ? "" : " Note: some hands are ambiguous."}`;
    this.render();
    return true;
  }

  private async export() {
    const report = await this.currentReport().catch(() => null);
    const text = report ? this.fileText(report) : this.model.text();
    download(`${this.host.table().id.replace(/[^a-z0-9-]+/gi, "-")}-strategy.txt`, text);
  }

  private async generate(tier: Tier, maxLines?: number) {
    if (this.generating) return;
    const table = this.host.table();
    this.generating = { tier, started: Date.now(), timer: window.setInterval(() => this.tick(), 1000) };
    this.live.clear();
    this.render();
    try {
      const engine = await this.host.engine(table);
      const res = await engine.request({
        kind: "generateStrategy",
        tier,
        seed: "",
        maxLines,
        bet: this.host.maxBet(),
        progressive: this.host.progressive() ?? undefined,
      });
      this.stopGenerating();
      this.replace(res.text, false);
      this.notice = `Generated a ${tier} strategy in ${(res.ms / 1000).toFixed(0)} s.`;
      this.render();
    } catch (e) {
      this.stopGenerating();
      this.notice = e instanceof Error && e.message === "cancelled" ? "Generation cancelled." : `Generation failed: ${e}`;
      this.evaluate();
      this.render();
    }
  }

  private tick() {
    const b = this.dlg.querySelector("#e-busy");
    if (b && this.generating) {
      b.innerHTML = this.busyHtml();
      b.querySelector("#e-cancel")?.addEventListener("click", () => this.cancelGenerate());
    }
  }

  private stopGenerating() {
    if (this.generating) clearInterval(this.generating.timer);
    this.generating = null;
  }

  private cancelGenerate() {
    this.host.cancelEngine();
  }
}
