// DEFAULT KEYBOARD CONTROLS — the one place to change them (SPEC §6.4).
// Values are KeyboardEvent.code names (physical keys, independent of layout).
// Players can remap these in Settings; this file is only the default.

import type { ButtonId } from "../input/actions";

export const DEFAULT_KEYMAP: Record<ButtonId, string[]> = {
  hold1: ["KeyZ"],
  hold2: ["KeyX"],
  hold3: ["KeyC"],
  hold4: ["KeyV"],
  hold5: ["KeyB"],
  dealDraw: ["Comma"],
  betMax: ["KeyM"], // also deals
  betOne: ["KeyN"], // provisional (SPEC §9)
  strategy: ["KeyS"], // strategy view (Practice and Lesson)
};
