// Game page: the cabinet in Free Play mode.
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

  resize();
  const sfx = new Sfx(prefs.muted, prefs.volume);
  const app = new GameApp(pix, loadTable(prefs.paytableId), prefs.progressive, prefs.credits, prefs.bet, prefs.speed, sfx);
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    // Off the input path: write after the frame.
    saveTimer = window.setTimeout(() => savePrefs(store, prefs), 50);
  };
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
    toggleFullscreen() {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.getElementById("cabinet")!.requestFullscreen();
    },
  });

  const keyboard = new KeyboardSource(window, prefs.keymap);
  keyboard.enabled = () => !menu.open;
  keyboard.start((b) => app.press(b));
  const pointer = new PointerSource(canvas, pix);
  pointer.enabled = () => !menu.open;
  pointer.start((b) => app.press(b));

  document.getElementById("menu-btn")!.onclick = () => menu.show();
  window.addEventListener("resize", () => {
    resize();
    app.request();
  });
  document.getElementById("loading")!.remove();
  app.request();
  // Exposed for automated latency checks in the browser.
  (window as unknown as { ovp: unknown }).ovp = app;
}

main().catch((e) => {
  document.getElementById("loading")!.textContent = `Failed to start: ${e}`;
});
