// Game page: the cabinet, with the trainer (Free Play, Practice, Lesson).
import init, { Rules as WasmRules, catalog as wasmCatalog, parseRule } from "./wasm/ovp_engine.js";
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
import { hasPresetStrategy, loadLevel, presetRules, strategyHeader } from "./strategies";
import { CustomStrategies } from "./customStrategies";
import { StrategyEditor } from "./ui/editor";
import { CompareScreen } from "./ui/compare";
import { LEVEL_TAGS } from "./render/strategyView";
import { LEVEL_NAMES } from "./config/trainer";
import { Trainer } from "./trainer/trainer";
import { defaultKv, Stats } from "./trainer/store";
import { StatsDialog, strategyRuleOrder } from "./ui/statsView";
import { StrategyScreen } from "./ui/strategyScreen";
import { inRect, strategyTagRect } from "./render/strategyView";
import { screenButtonRects } from "./render/cabinet";
import { isGameButton, type ButtonId } from "./input/actions";
import { keyLabel } from "./ui/settings";
import type { Level } from "./engine/protocol";
import { resolveSkin, SOUNDS } from "./skins/registry";
import { CardRenderer } from "./skins/cards";
import { loadArtInWorker } from "./skins/classic";

const store = safeLocalStorage();
const prefs = loadPrefs(store);
const kv = store ?? { getItem: () => null, setItem: () => {} };
const custom = new CustomTables(kv);
const myStrategies = new CustomStrategies(kv);

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
  let strategy = { key: null as string | null, text: "", info: "Loading strategy…", loaded: false };
  let strategyGen = 0;
  async function loadTrainer() {
    const gen = ++strategyGen;
    const t = findTable(prefs.paytableId)!;
    if (t.id.startsWith("custom:")) await engine.request({ kind: "loadCustom", paytable: t });
    else await engine.request({ kind: "load", paytableId: t.id });
    const text = await loadLevel(myStrategies, t.id, prefs.tier);
    if (gen !== strategyGen) return;
    // Requests run in order, so every check posted after this uses it.
    void engine.request({ kind: "setTrainerStrategy", text });
    if (text) {
      const ret = strategyHeader(text, "return")?.split(" ")[0] ?? "?";
      const loss = strategyHeader(text, "loss")?.split(" ")[0] ?? "?";
      strategy = { loaded: true, key: `${t.id}/${prefs.tier}`, text, info: `${t.name} ${LEVEL_NAMES[prefs.tier].toLowerCase()}: return ${ret}, ${loss} credits/hand below optimal.` };
    } else {
      const why = prefs.tier === "custom" ? "You haven't made a strategy of your own for this pay table (Strategy editor)" : "No preset strategy for this pay table yet (make one in the Strategy editor)";
      strategy = { loaded: true, key: null, text: "", info: `${why}: the trainer checks by Pure EV and rule stats are off.` };
    }
    menu.refresh();
    app.request(); // the strategy tag shows the loaded level
  }

  const stats = new Stats(defaultKv());
  await stats.load();

  resize();
  const skin = resolveSkin(prefs);
  const sfx = new Sfx(prefs.muted, prefs.volume, skin.sounds);
  const app = new GameApp(pix, loadTable(prefs.paytableId), prefs.progressive, prefs.credits, prefs.bet, prefs.speed, sfx);
  app.setCards(new CardRenderer(skin.faces, skin.backs));
  // Card art is generated in a worker; then each card is pre-rendered at
  // this screen scale in small idle slices.
  let artMs = 0;
  void loadArtInWorker().then((ms) => {
    artMs = ms;
    app.cards.prewarm(pix.k);
    app.request();
  });
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
        strategyTitle: t ? `${t.name} ${LEVEL_NAMES[prefs.tier].toLowerCase()}` : LEVEL_NAMES[prefs.tier],
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

  let sampleSfx: Sfx | null = null;
  const menu = new Menu(document.getElementById("menu") as HTMLDialogElement, {
    prefs,
    catalog,
    customTables: () => custom.list(),
    canChangeTable: () => app.state.phase === "ready",
    apply(changed) {
      if (changed.some((k) => k === "paytableId" || k === "progressive" || k === "labels"))
        app.setTable(loadTable(prefs.paytableId), prefs.progressive);
      if (changed.some((k) => k === "paytableId" || k === "tier")) void loadTrainer();
      if (changed.includes("paytableId")) strategyScreen.reset();
      if (changed.includes("mode")) trainer.modeChanged();
      if (changed.some((k) => k === "mode" || k === "checking" || k === "grace")) app.request();
      if (changed.includes("speed")) app.setSpeed(prefs.speed);
      if (changed.includes("muted") || changed.includes("volume")) {
        sfx.muted = prefs.muted;
        sfx.volume = prefs.volume;
        sfx.bet(); // audible feedback when turning sound on
      }
      if (changed.includes("keymap")) keyboard.setKeymap(prefs.keymap);
      if (changed.some((k) => k === "theme" || k === "faces" || k === "backs" || k === "sounds")) {
        const s = resolveSkin(prefs);
        app.cards.setSkin(s.faces, s.backs);
        app.cards.prewarm(pix.k);
        sfx.pack = s.sounds;
        app.request();
      }
      save();
    },
    playSample(id) {
      // A sample plays even with the sound off (the player asked for it).
      const pack = SOUNDS.find((x) => x.id === id) ?? sfx.pack;
      const sample = sampleSfx ?? (sampleSfx = new Sfx(false, prefs.volume || 0.35, pack));
      sample.cancelPayout();
      sample.pack = pack;
      sample.volume = prefs.volume || 0.35;
      sample.cards([0, 30, 60, 90, 120]);
      setTimeout(() => sample.hold(true), 260);
      setTimeout(() => sample.cards([0, 30]), 520);
      sample.payout({ atMs: 620, durMs: 900, amount: 45, bet: 5, big: false, top: false });
    },
    resetCredits() {
      app.setCredits(STARTING_CREDITS);
    },
    strategyInfo: () => strategy.info,
    showStats: () => statsDialog.show(),
    showEditor: () => void editor.show(),
    showCompare: () => compare.show(),
    hasCustom: () => myStrategies.has(prefs.paytableId),
    toggleFullscreen() {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.getElementById("cabinet")!.requestFullscreen();
    },
  });

  // Strategy view and its on-screen tag (Practice and Lesson only).
  const trainerMode = () => prefs.mode === "practice" || prefs.mode === "lesson";
  const strategyKey = () => keyLabel(prefs.keymap.strategy[0] ?? "").toUpperCase();
  const tagLabel = () => {
    if (!trainerMode() || strategyScreen.open) return null;
    const k = strategyKey();
    const name = prefs.tier === "custom" ? LEVEL_TAGS.custom : `${LEVEL_TAGS[prefs.tier]} STRATEGY`;
    return `${strategy.loaded && !strategy.key ? "NO STRATEGY" : name}${k ? ` (${k})` : ""}`;
  };
  app.tag = tagLabel;
  const strategyScreen = new StrategyScreen({
    loadText: (level) => loadLevel(myStrategies, prefs.paytableId, level),
    tier: () => prefs.tier,
    setTier(t) {
      prefs.tier = t;
      void loadTrainer();
      save();
    },
    title: () => `STRATEGY - ${app.label()}`,
    summary(text) {
      const ret = strategyHeader(text, "return")?.split(" ")[0] ?? "?";
      const loss = strategyHeader(text, "loss")?.split(" ")[0] ?? "?";
      return `RETURN ${ret}, ${loss} CREDITS/HAND BELOW OPTIMAL`;
    },
    closeKey: strategyKey,
    redraw: () => app.request(),
  });
  app.overlay = strategyScreen.draw;

  // Strategy editor and pay table comparison: their own engine worker
  // ("tools"), so long evaluations never delay the trainer's checks.
  let tools: EngineClient | null = null;
  let toolsTable = "";
  const toolsEngine = async (t: PayTableJson) => {
    if (!tools) {
      tools = new EngineClient();
      toolsTable = "";
    }
    const key = JSON.stringify(t);
    if (key !== toolsTable) {
      if (t.id.startsWith("custom:")) await tools.request({ kind: "loadCustom", paytable: t });
      else await tools.request({ kind: "load", paytableId: t.id });
      toolsTable = key;
    }
    return tools;
  };
  const cancelTools = () => {
    tools?.terminate();
    tools = null;
  };
  const allTables = () => [...catalog.paytables, ...custom.list()];
  const gameLabel = (id: string) => prefs.labels[id] || catalog.games.find((g) => g.id === id)?.label || id;
  const hasLevel = (tableId: string, l: Level) => (l === "custom" ? myStrategies.has(tableId) : hasPresetStrategy(tableId, l));
  const editor = new StrategyEditor(document.getElementById("editor") as HTMLDialogElement, {
    engine: toolsEngine,
    cancelEngine: cancelTools,
    table: () => findTable(prefs.paytableId)!,
    tableLabel: () => app.label(),
    maxBet: () => app.rules.maxBet,
    progressive: () => prefs.progressive,
    level: () => prefs.tier,
    hasLevel: (l) => hasLevel(prefs.paytableId, l),
    loadLevel: (l) => loadLevel(myStrategies, prefs.paytableId, l),
    suggestions: () => {
      const game = findTable(prefs.paytableId)!.game;
      return presetRules(catalog.paytables.filter((t) => t.game === game).map((t) => t.id));
    },
    parseRule,
    saveCustom(text, train) {
      myStrategies.save(prefs.paytableId, text);
      strategyScreen.reset();
      if (train && prefs.tier !== "custom") {
        prefs.tier = "custom";
        save();
      }
      if (prefs.tier === "custom") void loadTrainer();
    },
  });
  const compare = new CompareScreen(document.getElementById("compare") as HTMLDialogElement, {
    engine: toolsEngine,
    games: () => catalog.games,
    gameLabel,
    tables: allTables,
    currentTable: () => prefs.paytableId,
    currentLevel: () => prefs.tier,
    hasLevel,
    loadLevel: (id, l) => loadLevel(myStrategies, id, l),
  });

  const dialogsOpen = () => menu.open || statsDialog.open || editor.open || compare.open;
  /** Every button press (keyboard, pointer) comes through here. */
  const press = (b: ButtonId) => {
    if (b === "strategy") {
      if (strategyScreen.open || trainerMode()) strategyScreen.toggle();
      return;
    }
    if (strategyScreen.open || !isGameButton(b)) return; // the view is up: no play
    app.press(b);
  };

  const keyboard = new KeyboardSource(window, prefs.keymap);
  keyboard.enabled = () => !dialogsOpen();
  keyboard.start(press);
  const pointer = new PointerSource(canvas, pix, () => prefs.mode);
  pointer.enabled = () => !dialogsOpen() && !strategyScreen.open;
  pointer.start(press);
  // Clicks on the strategy tag and inside the strategy view.
  canvas.addEventListener("pointerdown", (e) => {
    if (dialogsOpen()) return;
    const { x, y } = pix.toLogical(canvas, e.clientX, e.clientY);
    // Keyboard focus follows the click (itch.io embeds the game in an iframe).
    window.focus();
    if (strategyScreen.click(x, y)) return;
    const tag = tagLabel();
    if (tag && inRect(strategyTagRect(tag), x, y)) return press("strategy");
    const hit = screenButtonRects().find(([, , r]) => inRect(r, x, y));
    if (hit?.[0] === "menu") menu.show();
    if (hit?.[0] === "stats") statsDialog.show();
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!strategyScreen.open) return;
      e.preventDefault();
      strategyScreen.scrollBy(Math.sign(e.deltaY) * 3);
    },
    { passive: false },
  );

  // Save stats before the page goes away.
  window.addEventListener("pagehide", () => void stats.flush());
  void loadTrainer();
  window.addEventListener("resize", () => {
    resize();
    app.cards.prewarm(pix.k);
    app.request();
  });
  document.getElementById("loading")!.remove();
  app.request();
  // Exposed for automated latency checks in the browser.
  (window as unknown as { ovp: unknown }).ovp = Object.assign(app, { trainerRef: trainer, statsRef: stats, prefsRef: prefs, artMs: () => artMs });
}

main().catch((e) => {
  document.getElementById("loading")!.textContent = `Failed to start: ${e}`;
});
