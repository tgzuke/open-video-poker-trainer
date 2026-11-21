import { EngineClient } from "./engine/client";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status");
const analyzeBtn = $<HTMLButtonElement>("analyze");
const holdsBtn = $<HTMLButtonElement>("holds-btn");
const engine = new EngineClient();
const BET = 5;

async function start() {
  const { buildMs } = await engine.request({ kind: "load", paytableId: "jacks-or-better-9-6" });
  status.textContent = `Engine ready (draw tables built in ${buildMs.toFixed(0)} ms, in a worker).`;
  analyzeBtn.disabled = false;
  holdsBtn.disabled = false;
}

analyzeBtn.onclick = async () => {
  analyzeBtn.disabled = true;
  $("analysis").textContent = "computing…";
  const r = await engine.request({ kind: "optimalReturn", bet: BET });
  $("analysis").textContent = `optimal return ${(r.ret * 100).toFixed(4)}% (${r.ms.toFixed(0)} ms)`;
  analyzeBtn.disabled = false;
};

$<HTMLFormElement>("holds-form").onsubmit = async (e) => {
  e.preventDefault();
  const out = $("holds");
  try {
    const { result, ms } = await engine.request({ kind: "holdEvs", hand: $<HTMLInputElement>("hand").value, bet: BET });
    const rows = result.evs
      .map((ev, m) => ({ ev, m }))
      .sort((a, b) => b.ev - a.ev)
      .map(({ ev, m }) => {
        const held = result.cards.map((c, i) => ((m >> i) & 1 ? c : "--")).join(" ");
        return `<tr class="${m === result.best ? "best" : ""}"><td>${held}</td><td>${ev.toFixed(6)}</td></tr>`;
      });
    out.innerHTML = `<p>32 holds in ${ms.toFixed(2)} ms (credits, ${BET}-coin bet)</p><table>${rows.join("")}</table>`;
  } catch (err) {
    out.innerHTML = "";
    const p = document.createElement("p");
    p.className = "err";
    p.textContent = String(err instanceof Error ? err.message : err);
    out.append(p);
  }
};

start().catch((e) => (status.textContent = `Engine failed to load: ${e}`));
