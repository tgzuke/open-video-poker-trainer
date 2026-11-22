// Stats screen (SPEC §5.4): session and lifetime side by side, mouse-driven.
import { DISTANCE_KEYS, type Agg, type StatsBook } from "../trainer/stats";

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
const n = (x: number) => x.toLocaleString("en-US");
const f4 = (x: number) => x.toFixed(4);
const per = (x: number, hands: number) => (hands ? f4(x / hands) : "—");
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(2)}%` : "—");

/** Rule texts of a strategy file, in order. */
export function strategyRuleOrder(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
}

function summaryRows(a: Agg): [string, string, string?][] {
  const sh = a.strategyHands;
  return [
    ["Hands played", n(a.hands)],
    ["Credits bet / won", `${n(a.wagered)} / ${n(a.won)}`],
    ["Net credits", n(a.won - a.wagered)],
    ["Actual return", pct(a.won, a.wagered)],
    ["(1) EV loss vs optimal", `${f4(a.lossVsOptimal)} (${per(a.lossVsOptimal, a.hands)}/hand)`, "credits"],
    ["(2) EV loss vs strategy", `${f4(a.lossVsStrategy)} (${per(a.lossVsStrategy, sh)}/hand)`, "credits; negative if you beat the strategy"],
    ["(3) Strategy's own loss", `${f4(a.strategyLoss)} (${per(a.strategyLoss, sh)}/hand)`, "credits; what the strategy gives up vs optimal"],
    ["Deviations from strategy", `${n(a.deviations)} of ${n(sh)} (${pct(a.deviations, sh)})`],
  ];
}

function histogram(a: Agg): string {
  const total = DISTANCE_KEYS.reduce((s, k) => s + (a.distance[k] ?? 0), 0);
  const label: Record<string, string> = { "0": "0 (correct)", off: "off-strategy" };
  return DISTANCE_KEYS.map((k) => {
    const v = a.distance[k] ?? 0;
    const w = total ? Math.round((160 * v) / total) : 0;
    return `<tr><td>${label[k] ?? k}</td><td class="num">${n(v)}</td><td><span class="bar d${k.replace("+", "p")}" style="width:${w}px"></span></td></tr>`;
  }).join("");
}

function results(a: Agg, lineOrder: string[]): string {
  const keys = [...lineOrder.filter((k) => a.results[k]), ...Object.keys(a.results).filter((k) => !lineOrder.includes(k))];
  if (!keys.length) return "<tr><td>—</td></tr>";
  return keys.map((k) => `<tr><td>${esc(k)}</td><td class="num">${n(a.results[k])}</td></tr>`).join("");
}

function ruleTable(a: Agg, key: string | null, order: string[]): string {
  const book = key ? a.rules[key] : undefined;
  if (!book) return `<div class="note">No hands with this strategy yet.</div>`;
  const keys = [...order.filter((r) => book[r]), ...Object.keys(book).filter((r) => !order.includes(r))];
  const rows = keys
    .map((r) => {
      const t = book[r];
      return `<tr><td>${esc(r)}</td><td class="num">${n(t.opportunities)}</td><td class="num">${n(t.misses)}</td><td class="num">${pct(t.misses, t.opportunities)}</td></tr>`;
    })
    .join("");
  return `<table class="rules"><tr><th>Rule</th><th>Chances</th><th>Misses</th><th>Miss rate</th></tr>${rows}</table>`;
}

export interface StatsContext {
  /** "paytable/tier" of the current strategy, and its title. */
  strategyKey: string | null;
  strategyTitle: string;
  ruleOrder: string[];
  lineOrder: string[];
}

export function statsHtml(book: StatsBook, ctx: StatsContext, confirming: keyof StatsBook | null): string {
  const col = (which: keyof StatsBook, title: string) => {
    const a = book[which];
    const since = new Date(a.since).toLocaleString();
    const rows = summaryRows(a)
      .map(([k, v, note]) => `<tr><td>${k}</td><td class="num" ${note ? `title="${esc(note)}"` : ""}>${v}</td></tr>`)
      .join("");
    const btn =
      confirming === which
        ? `<button data-reset="${which}" class="danger">Really reset ${title.toLowerCase()}?</button> <button data-cancel>Keep</button>`
        : `<button data-reset="${which}">Reset ${title.toLowerCase()}</button>`;
    return `<section>
      <h3>${title}</h3><div class="note">since ${esc(since)}</div>
      <table>${rows}</table>
      <h4>Rule distance</h4><table>${histogram(a)}</table>
      <h4>Results</h4><table>${results(a, ctx.lineOrder)}</table>
      <h4>Rules: ${esc(ctx.strategyTitle)}</h4>${ruleTable(a, ctx.strategyKey, ctx.ruleOrder)}
      <p>${btn}</p>
    </section>`;
  };
  return `<h2>STATS</h2>
    <div class="note">EV figures are in credits. Distance counts how many matching rules away from the strategy's play your hold was.</div>
    <div class="cols">${col("session", "Session")}${col("lifetime", "Lifetime")}</div>
    <p><button id="s-close">Close (Esc)</button></p>`;
}

export class StatsDialog {
  private confirming: keyof StatsBook | null = null;
  constructor(
    private dlg: HTMLDialogElement,
    private book: () => StatsBook,
    private ctx: () => StatsContext,
    private reset: (which: keyof StatsBook) => void,
  ) {
    dlg.addEventListener("close", () => (this.confirming = null));
  }
  get open() {
    return this.dlg.open;
  }
  show() {
    this.render();
    this.dlg.showModal();
  }
  refresh() {
    if (this.open) this.render();
  }
  private render() {
    this.dlg.innerHTML = statsHtml(this.book(), this.ctx(), this.confirming);
    this.dlg.querySelectorAll<HTMLButtonElement>("[data-reset]").forEach((b) => {
      b.onclick = () => {
        const which = b.dataset.reset as keyof StatsBook;
        if (this.confirming === which) {
          this.reset(which);
          this.confirming = null;
        } else this.confirming = which;
        this.render();
      };
    });
    this.dlg.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", () => {
      this.confirming = null;
      this.render();
    });
    this.dlg.querySelector<HTMLButtonElement>("#s-close")!.onclick = () => this.dlg.close();
  }
}
