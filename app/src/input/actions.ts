// Input abstraction (SPEC §6.4): every input source (keyboard now, GPIO
// buttons later) reports *buttons*; the game only ever sees GameActions.

/** Buttons that play the game. */
export type GameButton = "hold1" | "hold2" | "hold3" | "hold4" | "hold5" | "dealDraw" | "betMax" | "betOne";
/** All buttons: game buttons plus screen buttons (strategy view). */
export type ButtonId = GameButton | "strategy";

export const BUTTONS: ButtonId[] = ["hold1", "hold2", "hold3", "hold4", "hold5", "dealDraw", "betMax", "betOne", "strategy"];

export function isGameButton(b: ButtonId): b is GameButton {
  return b !== "strategy";
}

export const BUTTON_LABELS: Record<ButtonId, string> = {
  hold1: "Hold card 1",
  hold2: "Hold card 2",
  hold3: "Hold card 3",
  hold4: "Hold card 4",
  hold5: "Hold card 5",
  dealDraw: "Deal / Draw",
  betMax: "Bet Max (deals)",
  betOne: "Bet One",
  strategy: "Strategy view",
};

export type GameAction = { type: "hold"; index: number } | { type: "dealDraw" } | { type: "betMax" } | { type: "betOne" };

export function buttonToAction(b: GameButton): GameAction {
  switch (b) {
    case "hold1":
    case "hold2":
    case "hold3":
    case "hold4":
    case "hold5":
      return { type: "hold", index: Number(b.slice(4)) - 1 };
    case "dealDraw":
      return { type: "dealDraw" };
    case "betMax":
      return { type: "betMax" };
    case "betOne":
      return { type: "betOne" };
  }
}

/** A source of button presses (keyboard, on-screen buttons, GPIO…). */
export interface InputSource {
  start(press: (b: ButtonId) => void): void;
  stop(): void;
}
