// Settings menu (mouse-driven, SPEC §6.4): game and pay table, progressive,
// speed, sound, key remapping, game labels, credits, full screen.
import { DEFAULT_KEYMAP } from "../config/keymap";
import { SPEED_LEVELS, STARTING_CREDITS } from "../config/feel";
import { BUTTON_LABELS, BUTTONS, type ButtonId } from "../input/actions";
import { keymapConflicts } from "../input/keyboard";
import type { Catalog, PayTableJson } from "../engine/protocol";
import type { Prefs } from "./prefs";

export interface MenuHost {
  prefs: Prefs;
  catalog: Catalog;
  customTables(): PayTableJson[];
  canChangeTable(): boolean;
  /** Apply prefs (after any change) and save. */
  apply(changed: (keyof Prefs)[]): void;
  resetCredits(): void;
  toggleFullscreen(): void;
}

const SPEED_NAMES: Record<number, string> = { 1: "slow", 2: "medium", 3: "brisk", 4: "fast", 5: "instant" };

export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const named: Record<string, string> = {
    Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]",
    Backslash: "\\", Minus: "-", Equal: "=", Space: "Space", Enter: "Enter", Backquote: "`",
  };
  return named[code] ?? code;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export class Menu {
  private waitingFor: ButtonId | null = null;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(
    private dlg: HTMLDialogElement,
    private host: MenuHost,
  ) {
    dlg.addEventListener("close", () => {
      this.waitingFor = null;
      window.removeEventListener("keydown", this.keyHandler, true);
    });
  }

  get open() {
    return this.dlg.open;
  }

  show() {
    this.render();
    this.dlg.showModal();
    window.addEventListener("keydown", this.keyHandler, true);
  }

  private onKey(e: KeyboardEvent) {
    if (!this.waitingFor) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== "Escape") {
      this.host.prefs.keymap = { ...this.host.prefs.keymap, [this.waitingFor]: [e.code] };
      this.host.apply(["keymap"]);
    }
    this.waitingFor = null;
    this.render();
  }

  private render() {
    const p = this.host.prefs;
    const c = this.host.catalog;
    const tables = [...c.paytables, ...this.host.customTables()];
    const options = c.games
      .map((g) => {
        const label = p.labels[g.id] || g.label;
        const opts = tables
          .filter((t) => t.game === g.id)
          .map((t) => `<option value="${esc(t.id)}" ${t.id === p.paytableId ? "selected" : ""}>${esc(label)} ${esc(t.name)}</option>`)
          .join("");
        return `<optgroup label="${esc(label)}">${opts}</optgroup>`;
      })
      .join("");
    const current = tables.find((t) => t.id === p.paytableId);
    const game = c.games.find((g) => g.id === current?.game);
    const conflicts = keymapConflicts(p.keymap);
    const keys = BUTTONS.map(
      (b) =>
        `<tr><td>${BUTTON_LABELS[b]}</td><td>${p.keymap[b].map(keyLabel).join(" ") || "—"}</td>` +
        `<td><button data-remap="${b}" class="${this.waitingFor === b ? "waiting" : ""}">${this.waitingFor === b ? "press a key… (Esc cancels)" : "Change"}</button></td></tr>`,
    ).join("");
    const lock = this.host.canChangeTable() ? "" : "disabled";
    this.dlg.innerHTML = `
      <h2>MENU</h2>
      <h3>Game</h3>
      <label>Pay table <select id="m-table" ${lock}>${options}</select></label>
      ${lock ? `<div class="note">Finish the hand to change the game.</div>` : ""}
      <label>Game label <input id="m-label" value="${esc(game ? p.labels[game.id] ?? "" : "")}" placeholder="${esc(game?.label ?? "")}" size="22" /></label>
      <label>Progressive royal (credits at max bet) <input id="m-prog" type="number" min="0" step="1" value="${p.progressive ?? ""}" placeholder="none" size="8" ${lock} /></label>
      <h3>Speed</h3>
      <label class="row"><input id="m-speed" type="range" min="${SPEED_LEVELS[0]}" max="${SPEED_LEVELS[SPEED_LEVELS.length - 1]}" step="1" value="${p.speed}" /> <span>${SPEED_NAMES[p.speed]}</span></label>
      <h3>Sound</h3>
      <div class="row">
        <label><input id="m-sound" type="checkbox" ${p.muted ? "" : "checked"} /> Sound on</label>
        <label>Volume <input id="m-vol" type="range" min="0" max="1" step="0.05" value="${p.volume}" /></label>
      </div>
      <h3>Controls</h3>
      <table>${keys}</table>
      ${conflicts.length ? `<div class="warn">Same key on several buttons: ${conflicts.map(keyLabel).join(", ")}</div>` : ""}
      <button id="m-keys-reset">Reset keys to defaults</button>
      <h3>Credits</h3>
      <div class="row"><span>${p.credits} credits</span><button id="m-credits" ${lock}>Reset to ${STARTING_CREDITS}</button></div>
      <div class="note">Play credits only. Nothing here is money.</div>
      <h3>Display</h3>
      <button id="m-full">Full screen on/off</button>
      <p><button id="m-close">Close (Esc)</button></p>`;
    const $ = <T extends HTMLElement>(id: string) => this.dlg.querySelector<T>(`#${id}`)!;
    $<HTMLSelectElement>("m-table").onchange = (e) => {
      p.paytableId = (e.target as HTMLSelectElement).value;
      this.host.apply(["paytableId"]);
      this.render();
    };
    $<HTMLInputElement>("m-label").onchange = (e) => {
      if (!game) return;
      const v = (e.target as HTMLInputElement).value.trim();
      p.labels = { ...p.labels, [game.id]: v };
      if (!v) delete p.labels[game.id];
      this.host.apply(["labels"]);
      this.render();
    };
    $<HTMLInputElement>("m-prog").onchange = (e) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      const v = Number(raw);
      p.progressive = raw === "" || !Number.isInteger(v) || v < 0 ? null : v;
      this.host.apply(["progressive"]);
      this.render();
    };
    $<HTMLInputElement>("m-speed").oninput = (e) => {
      p.speed = Number((e.target as HTMLInputElement).value);
      this.host.apply(["speed"]);
      (e.target as HTMLInputElement).nextElementSibling!.textContent = SPEED_NAMES[p.speed];
    };
    $<HTMLInputElement>("m-sound").onchange = (e) => {
      p.muted = !(e.target as HTMLInputElement).checked;
      this.host.apply(["muted"]);
    };
    $<HTMLInputElement>("m-vol").oninput = (e) => {
      p.volume = Number((e.target as HTMLInputElement).value);
      this.host.apply(["volume"]);
    };
    this.dlg.querySelectorAll<HTMLButtonElement>("[data-remap]").forEach((btn) => {
      btn.onclick = () => {
        this.waitingFor = btn.dataset.remap as ButtonId;
        this.render();
      };
    });
    $("m-keys-reset").onclick = () => {
      p.keymap = { ...DEFAULT_KEYMAP };
      this.host.apply(["keymap"]);
      this.render();
    };
    $("m-credits").onclick = () => {
      this.host.resetCredits();
      this.render();
    };
    $("m-full").onclick = () => this.host.toggleFullscreen();
    $("m-close").onclick = () => this.dlg.close();
  }
}
