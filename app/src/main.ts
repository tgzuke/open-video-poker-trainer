// Game page: the cabinet, with the trainer (Free Play, Practice, Lesson).
import init, { Rules as WasmRules, catalog as wasmCatalog } from "./wasm/ovp_engine.js";
import { GameApp, type Table } from "./game/app";
import { KeyboardSource } from "./input/keyboard";
import { PointerSource } from "./input/pointer";
import { Pix } from "./render/pix";
import { Sfx } from "./audio/sfx";
import { CustomTables } from "./customTables";
import type { Catalog, PayTableJson } from "./engine/protocol";
import { Menu } from "./ui/settings";
import { DEFAULT_PREFS, loadPrefs, safeLocalStorage, savePrefs } from "./ui/prefs";
import { STARTING_CREDITS } from "./config/feel";
import { EngineClient } from "./engine/client";
import { hasPresetStrategy, loadPresetStrategy, strategyHeader } from "./strategies";
import { Trainer } from "./trainer/trainer";
import { defaultKv, Stats } from "./trainer/store";
import { StatsDialog, strategyRuleOrder } from "./ui/statsView";

const store = safeLocalStorage();
const prefs = loadPrefs(store);
const custom = new CustomTables(store ?? { getItem: () => null, setItem: () => {} });

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
const pix = new Pix(ctx);

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  pix.fit(canvas.width, canvas.height);
}

async function main() {
  await init();
  const catalog = JSON.parse(wasmCatalog()) as Catalog;

  const findTable = (id: string): PayTableJson | undefined =>
    catalog.paytables.find((t) => t.id === id) ?? custom.list().find((t) => t.id === id);

  function loadTable(id: string): Table {
    const t = findTable(id) ?? findTable(DEFAULT_PREFS.paytableId)!;
    const wasm = t.id.startsWith("custom:") ? WasmRules.withPaytable(JSON.stringify(t)) : WasmRules.builtin(t.id);
    const g = catalog.games.find((x) => x.id === t.game)!;
    prefs.paytableId = t.id;
    return { wasm, label: `${prefs.labels[g.id] || g.label} ${t.name}`, lineNames: Array.from(wasm.lineNames()) };
  }

  // Engine worker: per-hand trainer checks (and the strategy they use).
  const engine = new EngineClient();
  let strategy = { key: null as string | null, text: "", info: "Loading strategy…" };
  let strategyGen = 0;
  async function loadTrainer() {
    const gen = ++strategyGen;
    const t = findTable(prefs.paytableId)!;
    if (t.id.startsWith("custom:")) await engine.request({ kind: "loadCustom", paytable: t });
    else await engine.request({ kind: "load", paytableId: t.id });
    let text = "";
    if (hasPresetStrategy(t.id, prefs.tier)) text = await loadPresetStrategy(t.id, prefs.tier);
    if (gen !== strategyGen) return;
    // Requests run in order, so every check posted after this uses it.
    void engine.request({ kind: "setTrainerStrategy", text });
    if (text) {
      const ret = strategyHeader(text, "return")?.split(" ")[0] ?? "?";
      const loss = strategyHeader(text, "loss")?.split(" ")[0] ?? "?";
      strategy = { key: `${t.id}/${prefs.tier}`, text, info: `${t.name} ${prefs.tier} strategy: return ${ret}, ${loss} credits/hand below optimal.` };
    } else {
      strategy = { key: null, text: "", info: "No preset strategy for this pay table yet: the trainer checks by Pure EV and rule stats are off." };
    }
    menu.refresh();
  }

  const stats = new Stats(defaultKv());
  await stats.load();

  resize();
  const sfx = new Sfx(prefs.muted, prefs.volume);
  const app = new GameApp(pix, loadTable(prefs.paytableId), prefs.progressive, prefs.credits, prefs.bet, prefs.speed, sfx);
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    // Off the input path: write after the frame.
    saveTimer = window.setTimeout(() => savePrefs(store, prefs), 50);
  };
  const trainer = new Trainer(
    (cards, bet) => {
      const key = strategy.key;
      return engine
        .request({ kind: "dealCheck", cards, bet, progressive: prefs.progressive ?? undefined })
        .then((r) => ({ check: r.check, strategyKey: r.check.strategy ? key : null }));
    },
    () => ({ mode: prefs.mode, checking: prefs.checking, grace: prefs.grace, maxBet: app.rules.maxBet }),
    (r) => stats.add(r),
  );
  app.attachTrainer(trainer, () => prefs.mode);
  const statsDialog = new StatsDialog(
    document.getElementById("stats") as HTMLDialogElement,
    () => stats.book,
    () => {
      const t = findTable(prefs.paytableId);
      return {
        strategyKey: strategy.key,
        strategyTitle: t ? `${t.name} ${prefs.tier}` : prefs.tier,
        ruleOrder: strategyRuleOrder(strategy.text),
        lineOrder: [...app.lineNames(), "No win"],
      };
    },
    (which) => stats.reset(which),
  );
  stats.onChange = () => statsDialog.refresh();

  app.onChange = (s) => {
    prefs.credits = s.credits;
    prefs.bet = s.bet;
    save();
  };

  const menu = new Menu(document.getElementById("menu") as HTMLDialogElement, {
    prefs,
    catalog,
    customTables: () => custom.list(),
    canChangeTable: () => app.state.phase === "ready",
    apply(changed) {
      if (changed.some((k) => k === "paytableId" || k === "progressive" || k === "labels"))
        app.setTable(loadTable(prefs.paytableId), prefs.progressive);
      if (changed.some((k) => k === "paytableId" || k === "tier")) void loadTrainer();
      if (changed.includes("mode")) trainer.modeChanged();
      if (changed.some((k) => k === "mode" || k === "checking" || k === "grace")) app.request();
      if (changed.includes("speed")) app.setSpeed(prefs.speed);
      if (changed.includes("muted") || changed.includes("volume")) {
        sfx.muted = prefs.muted;
        sfx.volume = prefs.volume;
        sfx.bet(); // audible feedback when turning sound on
      }
      if (changed.includes("keymap")) keyboard.setKeymap(prefs.keymap);
      save();
    },
    resetCredits() {
      app.setCredits(STARTING_CREDITS);
    },
    strategyInfo: () => strategy.info,
    showStats: () => statsDialog.show(),
    toggleFullscreen() {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.getElementById("cabinet")!.requestFullscreen();
    },
  });

  const keyboard = new KeyboardSource(window, prefs.keymap);
  keyboard.enabled = () => !menu.open && !statsDialog.open;
  keyboard.start((b) => app.press(b));
  const pointer = new PointerSource(canvas, pix, () => prefs.mode);
  pointer.enabled = () => !menu.open && !statsDialog.open;
  pointer.start((b) => app.press(b));

  document.getElementById("menu-btn")!.onclick = () => menu.show();
  document.getElementById("stats-btn")!.onclick = () => statsDialog.show();
  // Save stats before the page goes away.
  window.addEventListener("pagehide", () => void stats.flush());
  void loadTrainer();
  window.addEventListener("resize", () => {
    resize();
    app.request();
  });
  document.getElementById("loading")!.remove();
  app.request();
  // Exposed for automated latency checks in the browser.
  (window as unknown as { ovp: unknown }).ovp = Object.assign(app, { trainerRef: trainer, statsRef: stats, prefsRef: prefs });
}

main().catch((e) => {
  document.getElementById("loading")!.textContent = `Failed to start: ${e}`;
});
