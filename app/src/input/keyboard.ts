// Keyboard input source: maps physical keys to buttons via a keymap.
import type { ButtonId, InputSource } from "./actions";

export type Keymap = Record<ButtonId, string[]>;

/** Reverse lookup code → button. Later entries never override earlier. */
export function indexKeymap(map: Keymap): Map<string, ButtonId> {
  const idx = new Map<string, ButtonId>();
  for (const [button, codes] of Object.entries(map) as [ButtonId, string[]][])
    for (const c of codes) if (!idx.has(c)) idx.set(c, button);
  return idx;
}

/** Keys bound to more than one button. */
export function keymapConflicts(map: Keymap): string[] {
  const seen = new Map<string, number>();
  for (const codes of Object.values(map)) for (const c of codes) seen.set(c, (seen.get(c) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([c]) => c);
}

export interface KeyTarget {
  addEventListener(type: "keydown", fn: (e: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", fn: (e: KeyboardEvent) => void): void;
}

export class KeyboardSource implements InputSource {
  private index: Map<string, ButtonId>;
  private handler: ((e: KeyboardEvent) => void) | null = null;
  /** When this returns false (e.g. a menu is open), keys are ignored. */
  enabled: () => boolean = () => true;

  constructor(
    private target: KeyTarget,
    keymap: Keymap,
  ) {
    this.index = indexKeymap(keymap);
  }

  setKeymap(map: Keymap) {
    this.index = indexKeymap(map);
  }

  start(press: (b: ButtonId) => void) {
    this.handler = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || !this.enabled()) return;
      const b = this.index.get(e.code);
      if (!b) return;
      e.preventDefault();
      press(b);
    };
    this.target.addEventListener("keydown", this.handler);
  }

  stop() {
    if (this.handler) this.target.removeEventListener("keydown", this.handler);
    this.handler = null;
  }
}
