// Trainer defaults (SPEC §5). Tune after playtesting.
import type { Level, Tier } from "../engine/protocol";

export type Mode = "free" | "practice" | "lesson";
export type Checking = "strategy" | "ev";

export const MODE_NAMES: Record<Mode, string> = { free: "Free Play", practice: "Practice", lesson: "Lesson" };
export const CHECKING_NAMES: Record<Checking, string> = { strategy: "Strategy", ev: "Pure EV" };

/** Strategy levels as menus and dialogs name them. */
export const LEVEL_NAMES: Record<Level, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  expert: "Expert",
  custom: "My strategy",
};

export const DEFAULT_MODE: Mode = "practice";
export const DEFAULT_CHECKING: Checking = "strategy";
/** Strategy the trainer checks against, by default. */
export const DEFAULT_TIER: Tier = "intermediate";
/** Pure EV grace margin in credits at max bet; scaled with bet (§5.1). */
export const DEFAULT_GRACE = 0.05;

/** Feedback box and lesson hint colors. */
export const FEEDBACK = {
  green: "#20c040",
  yellow: "#ffd800",
  red: "#e02020",
  ink: "#000000",
  boxBg: "#06105c",
  text: "#f8f8f0",
  dim: "#aab4ff",
  hint: "#20e050",
};

/** Lesson messages, by mistake count (SPEC §5.2). */
export const LESSON_TEXT = {
  first: "NOT THE BEST HOLD - TRY AGAIN",
  rule: (rule: string) => `USE: ${rule}`,
  hold: "HOLD THE MARKED CARDS",
};
