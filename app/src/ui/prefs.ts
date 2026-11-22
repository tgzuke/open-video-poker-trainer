// Player preferences, saved locally (localStorage). Reads and writes are
// guarded: private mode or blocked storage just means defaults.
import { DEFAULT_KEYMAP } from "../config/keymap";
import { DEFAULT_SOUND, DEFAULT_SPEED, SPEED_LEVELS, STARTING_CREDITS } from "../config/feel";
import { BUTTONS, type ButtonId } from "../input/actions";
import type { Keymap } from "../input/keyboard";
import { DEFAULT_CHECKING, DEFAULT_GRACE, DEFAULT_MODE, DEFAULT_TIER, type Checking, type Mode } from "../config/trainer";
import { TIERS, type Tier } from "../engine/protocol";

export interface Prefs {
  paytableId: string;
  /** Progressive royal (whole credits at max bet), or null for none. */
  progressive: number | null;
  speed: number;
  muted: boolean;
  volume: number;
  keymap: Keymap;
  /** Player-renamed game labels, by game id. */
  labels: Record<string, string>;
  credits: number;
  bet: number;
  /** Trainer (SPEC §5). */
  mode: Mode;
  checking: Checking;
  /** Pure EV grace margin, credits at max bet. */
  grace: number;
  tier: Tier;
}

export const DEFAULT_PREFS: Prefs = {
  paytableId: "jacks-or-better-9-6",
  progressive: null,
  speed: DEFAULT_SPEED,
  muted: DEFAULT_SOUND.muted,
  volume: DEFAULT_SOUND.volume,
  keymap: DEFAULT_KEYMAP,
  labels: {},
  credits: STARTING_CREDITS,
  bet: 1,
  mode: DEFAULT_MODE,
  checking: DEFAULT_CHECKING,
  grace: DEFAULT_GRACE,
  tier: DEFAULT_TIER,
};

const KEY = "ovp.prefs.v1";

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function validKeymap(x: unknown): x is Keymap {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  return BUTTONS.every((b) => Array.isArray(m[b]) && (m[b] as unknown[]).every((c) => typeof c === "string"));
}

export function loadPrefs(store: Store | null): Prefs {
  let raw: unknown = null;
  try {
    raw = JSON.parse(store?.getItem(KEY) ?? "null");
  } catch {
    raw = null;
  }
  const p = { ...DEFAULT_PREFS, keymap: { ...DEFAULT_KEYMAP } };
  if (typeof raw !== "object" || raw === null) return p;
  const r = raw as Partial<Record<keyof Prefs, unknown>>;
  if (typeof r.paytableId === "string") p.paytableId = r.paytableId;
  if (r.progressive === null || (Number.isInteger(r.progressive) && (r.progressive as number) >= 0))
    p.progressive = r.progressive as number | null;
  if (SPEED_LEVELS.includes(r.speed as never)) p.speed = r.speed as number;
  if (typeof r.muted === "boolean") p.muted = r.muted;
  if (typeof r.volume === "number" && r.volume >= 0 && r.volume <= 1) p.volume = r.volume;
  if (validKeymap(r.keymap)) p.keymap = r.keymap as Record<ButtonId, string[]>;
  if (typeof r.labels === "object" && r.labels !== null)
    p.labels = Object.fromEntries(Object.entries(r.labels).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  if (Number.isInteger(r.credits) && (r.credits as number) >= 0) p.credits = r.credits as number;
  if (Number.isInteger(r.bet) && (r.bet as number) >= 1) p.bet = r.bet as number;
  if (r.mode === "free" || r.mode === "practice" || r.mode === "lesson") p.mode = r.mode;
  if (r.checking === "strategy" || r.checking === "ev") p.checking = r.checking;
  if (typeof r.grace === "number" && Number.isFinite(r.grace) && r.grace >= 0) p.grace = r.grace;
  if (TIERS.includes(r.tier as Tier)) p.tier = r.tier as Tier;
  return p;
}

export function savePrefs(store: Store | null, p: Prefs) {
  try {
    store?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: preferences just don't persist */
  }
}

export function safeLocalStorage(): Store | null {
  try {
    const s = window.localStorage;
    s.getItem(KEY);
    return s;
  } catch {
    return null;
  }
}
