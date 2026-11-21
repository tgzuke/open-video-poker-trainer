// Developer shell (until the cabinet UI in Milestone 4): pick a pay table,
// bet and progressive; see the optimal return and hold EVs.
import { EngineClient } from "./engine/client";
import type { Catalog, PayTableJson, StrategyReport, Tier } from "./engine/protocol";
import { TIERS } from "./engine/protocol";
import { CustomTables } from "./customTables";
import { hasPresetStrategy, loadPresetStrategy } from "./strategies";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const engine = new EngineClient();
const custom = new CustomTables(window.localStorage);
let catalog: Catalog;
let current: PayTableJson;
let strategyText: string | null = null;

const tableSel = $<HTMLSelectElement>("paytable");
const betSel = $<HTMLSelectElement>("bet");
const progInput = $<HTMLInputElement>("progressive");
const status = $("status");

function allTables(): PayTableJson[] {
  return [...catalog.paytables, ...custom.list()];
}

function wager() {
  const bet = Number(betSel.value);
  const raw = progInput.value.trim();
  const progressive = raw === "" ? undefined : Number(raw);
  if (progressive !== undefined && !(Number.isInteger(progressive) && progressive >= 0))
    throw new Error("Progressive must be whole credits ≥ 0");
  return { bet, progressive };
}

function fillTables(selectId?: string) {
  tableSel.innerHTML = "";
  for (const g of catalog.games) {
    const group = document.createElement("optgroup");
    group.label = g.label;
    for (const t of allTables().filter((t) => t.game === g.id)) {
      const o = new Option(`${g.label} ${t.name}`, t.id);
      group.append(o);
    }
    tableSel.append(group);
  }
  if (selectId) tableSel.value = selectId;
}

function renderPays() {
  const game = catalog.games.find((g) => g.id === current.game)!;
  const rows = game.lines.map(
    (l) => `<tr><td>${l.name}</td><td><input data-line="${l.id}" type="number" min="0" step="1" value="${current.pays[l.id]}" size="5"></td></tr>`,
  );
  $("pays").innerHTML = `<table>${rows.join("")}</table>`;
}

async function selectTable(id: string) {
  const t = allTables().find((x) => x.id === id);
  if (!t) return;
  current = t;
  status.textContent = "Loading…";
  const r = id.startsWith("custom:")
    ? await engine.request({ kind: "loadCustom", paytable: t })
    : await engine.request({ kind: "load", paytableId: id });
  status.textContent = r.rebuilt
    ? `Engine ready (draw tables built in ${r.buildMs.toFixed(0)} ms, in a worker).`
    : `Pay table switched in ${r.buildMs.toFixed(1)} ms (no rebuild).`;
  renderPays();
  $("analysis").textContent = "";
  strategyText = null;
  $("strategy").innerHTML = "";
  $("strategy-status").textContent = "";
}

const tierSel = $<HTMLSelectElement>("tier");
const pct = (x: number, d = 4) => `${(x * 100).toFixed(d)}%`;

function renderStrategy(report: StrategyReport, source: string) {
  const rows = report.rules.map(
    (r, i) =>
      `<tr><td class="num">${i + 1}</td><td>${r.text}</td><td class="num">${pct(r.fires, 3)}</td>` +
      `<td class="num">${pct(r.disagrees, 3)}</td><td class="num">${r.loss.toFixed(6)}</td></tr>`,
  );
  const problems = report.complete
    ? "complete"
    : `<span class="err">INCOMPLETE: ${report.undefinedCount} undefined, ${report.ambiguousCount} ambiguous</span>`;
  $("strategy").innerHTML =
    `<p>${source}: return ${pct(report.return)} (optimal ${pct(report.optimal)}), ` +
    `loss ${report.lossCredits.toFixed(6)} credits/hand, ${report.rules.length} lines, ${problems}</p>` +
    `<table><tr><td>#</td><td>Rule</td><td>Fires</td><td>Wrong</td><td>Loss cr/hand</td></tr>${rows.join("")}</table>`;
}

async function showStrategy(text: string, source: string) {
  const r = await engine.request({ kind: "evaluateStrategy", text, ...wager() });
  strategyText = text;
  renderStrategy(r.report, `${source} (evaluated in ${r.ms.toFixed(0)} ms)`);
}

async function loadStrategy() {
  const tier = tierSel.value as Tier;
  try {
    if (!hasPresetStrategy(current.id, tier)) throw new Error("no preset strategy for this table — use Generate");
    const w = wager();
    if (w.bet !== 5 || w.progressive !== undefined)
      $("strategy-status").textContent = "note: presets are generated for max bet, no progressive";
    await showStrategy(await loadPresetStrategy(current.id, tier), `Preset ${tier}`);
  } catch (e) {
    $("strategy-status").textContent = String(e instanceof Error ? e.message : e);
  }
}

async function generateStrategy() {
  const want = tierSel.value as Tier;
  const btn = $<HTMLButtonElement>("generate-strategy");
  btn.disabled = true;
  try {
    let seed = "";
    const t0 = performance.now();
    // Lower tiers seed the requested one (as the CLI does).
    for (const tier of TIERS.slice(0, TIERS.indexOf(want) + 1)) {
      $("strategy-status").textContent = `generating ${tier}… (${((performance.now() - t0) / 1000).toFixed(0)} s)`;
      seed = (await engine.request({ kind: "generateStrategy", tier, seed, ...wager() })).text;
    }
    $("strategy-status").textContent = `generated in ${((performance.now() - t0) / 1000).toFixed(1)} s (in the worker)`;
    await showStrategy(seed, `Generated ${want}`);
  } catch (e) {
    $("strategy-status").textContent = String(e instanceof Error ? e.message : e);
  } finally {
    btn.disabled = false;
  }
}

async function analyze() {
  try {
    $("analysis").textContent = "computing…";
    const r = await engine.request({ kind: "optimalReturn", ...wager() });
    const pub = current.published_return_pct;
    $("analysis").textContent =
      `optimal return ${(r.ret * 100).toFixed(4)}% (${r.ms.toFixed(0)} ms)` +
      (pub !== undefined ? ` — published ≈ ${pub}% (info only)` : "");
  } catch (e) {
    $("analysis").textContent = String(e instanceof Error ? e.message : e);
  }
}

async function showHolds() {
  const out = $("holds");
  try {
    const w = wager();
    const { result, ms } = await engine.request({ kind: "holdEvs", hand: $<HTMLInputElement>("hand").value, ...w });
    const rows = result.evs
      .map((ev, m) => ({ ev, m }))
      .sort((a, b) => b.ev - a.ev)
      .map(({ ev, m }) => {
        const held = result.cards.map((c, i) => ((m >> i) & 1 ? c : "--")).join(" ");
        return `<tr class="${m === result.best ? "best" : ""}"><td>${held}</td><td>${ev.toFixed(6)}</td></tr>`;
      });
    let ruleLine = "";
    if (strategyText) {
      const { play } = await engine.request({ kind: "playStrategy", text: strategyText, hand: $<HTMLInputElement>("hand").value });
      const held = play.cards.map((c, i) => ((play.hold >> i) & 1 ? c : "--")).join(" ");
      const rules = strategyText.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      ruleLine =
        `<p>Strategy: ${held} — rule ${play.rule === null ? "none" : `${play.rule + 1}: ${rules[play.rule].split("#")[0].trim()}`}` +
        ` ${result.evs[play.hold] === result.evs[result.best] ? "(optimal)" : `(EV ${result.evs[play.hold].toFixed(4)} vs best ${result.evs[result.best].toFixed(4)})`}</p>`;
    }
    out.innerHTML = `${ruleLine}<p>32 holds in ${ms.toFixed(2)} ms (credits, bet ${w.bet})</p><table>${rows.join("")}</table>`;
  } catch (err) {
    out.innerHTML = "";
    const p = document.createElement("p");
    p.className = "err";
    p.textContent = String(err instanceof Error ? err.message : err);
    out.append(p);
  }
}

async function saveCustom() {
  try {
    const pays: Record<string, number> = {};
    for (const el of document.querySelectorAll<HTMLInputElement>("#pays input[data-line]"))
      pays[el.dataset.line!] = Number(el.value);
    const name = $<HTMLInputElement>("custom-name").value || "Custom";
    const base = catalog.paytables.find((t) => t.game === current.game && t.id === current.id) ?? current;
    const t = custom.save(base, name, pays);
    // Validate in the engine before keeping it selected.
    await engine.request({ kind: "loadCustom", paytable: t });
    fillTables(t.id);
    await selectTable(t.id);
  } catch (e) {
    status.textContent = `Not saved: ${e instanceof Error ? e.message : e}`;
  }
}

async function start() {
  catalog = (await engine.request({ kind: "catalog" })).catalog;
  fillTables("jacks-or-better-9-6");
  await selectTable("jacks-or-better-9-6");
  for (const b of ["analyze", "holds-btn", "save-custom", "load-strategy", "generate-strategy"])
    $<HTMLButtonElement>(b).disabled = false;
}

tableSel.onchange = () => selectTable(tableSel.value);
$("analyze").onclick = analyze;
$("save-custom").onclick = saveCustom;
$("load-strategy").onclick = loadStrategy;
$("generate-strategy").onclick = generateStrategy;
$<HTMLFormElement>("holds-form").onsubmit = (e) => {
  e.preventDefault();
  showHolds();
};
start().catch((e) => (status.textContent = `Engine failed to load: ${e}`));
