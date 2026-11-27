// Skin registry: every face, back and sound pack by id, and the themes
// that bundle them. Lookups never fail: an unknown id falls back to the
// theme's part (and an unknown theme to the default theme).
import { DEFAULT_THEME } from "../config/skins";
import { BASIC_BACK, BASIC_FACES, BASIC_SOUNDS } from "./basic";
import { CLASSIC_BACKS, CLASSIC_FACES } from "./classic";
import { CLASSIC_BACK } from "./art/backs";
import { CLASSIC_SOUNDS } from "./sounds";
import type { BackSkin, FaceSkin, SoundPack, Theme } from "./types";

export const FACES: FaceSkin[] = [BASIC_FACES, CLASSIC_FACES];
export const BACKS: BackSkin[] = [BASIC_BACK, ...CLASSIC_BACKS];
export const SOUNDS: SoundPack[] = [BASIC_SOUNDS, CLASSIC_SOUNDS];

export const THEMES: Theme[] = [
  { id: "basic", name: "Basic", faces: BASIC_FACES.id, backs: BASIC_BACK.id, sounds: BASIC_SOUNDS.id },
  { id: "classic", name: "Classic", faces: CLASSIC_FACES.id, backs: CLASSIC_BACK, sounds: CLASSIC_SOUNDS.id },
];

export const MIXED = "Custom (mixed)";

const byId = <T extends { id: string }>(xs: T[], id: string | undefined): T | undefined => xs.find((x) => x.id === id);

export function theme(id: string | undefined): Theme {
  return byId(THEMES, id) ?? byId(THEMES, DEFAULT_THEME)!;
}

/** The skin choice saved in prefs. */
export interface SkinChoice {
  theme: string;
  faces: string;
  backs: string;
  sounds: string;
}

export interface Skin {
  faces: FaceSkin;
  backs: BackSkin;
  sounds: SoundPack;
}

/** Resolves a saved choice; unknown ids fall back to the theme's parts. */
export function resolveSkin(c: Partial<SkinChoice>): Skin {
  const t = theme(c.theme);
  return {
    faces: byId(FACES, c.faces) ?? byId(FACES, t.faces)!,
    backs: byId(BACKS, c.backs) ?? byId(BACKS, t.backs)!,
    sounds: byId(SOUNDS, c.sounds) ?? byId(SOUNDS, t.sounds)!,
  };
}

/** Ids used before the rename ("Default" became "Classic", and Basic's
 *  back, once called "classic", became "basic"), per part. */
const LEGACY: Record<keyof SkinChoice, Record<string, string>> = {
  theme: { default: "classic" },
  faces: { default: "classic" },
  backs: { classic: "basic" },
  sounds: { default: "classic" },
};

/** A saved id, carried over from its old name if it was renamed. */
export function currentId(part: keyof SkinChoice, id: string): string {
  return LEGACY[part][id] ?? id;
}

/** The choice that picking a theme makes: all three of its parts. */
export function pickTheme(id: string): SkinChoice {
  const t = theme(id);
  return { theme: t.id, faces: t.faces, backs: t.backs, sounds: t.sounds };
}

/** Name to show for the current choice: the theme, or "Custom (mixed)"
 *  once any part differs from it. */
export function themeLabel(c: Partial<SkinChoice>): string {
  const t = theme(c.theme);
  const s = resolveSkin(c);
  return s.faces.id === t.faces && s.backs.id === t.backs && s.sounds.id === t.sounds ? t.name : MIXED;
}
