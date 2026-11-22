// Shipped preset strategies (generated offline by `ovp strategy generate --all`).
import type { Level, Tier } from "./engine/protocol";
import type { CustomStrategies } from "./customStrategies";

const files = import.meta.glob("../../strategies/*/*.txt", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

function key(paytableId: string, tier: Tier): string {
  return `../../strategies/${paytableId}/${tier}.txt`;
}

export function hasPresetStrategy(paytableId: string, tier: Tier): boolean {
  return key(paytableId, tier) in files;
}

export async function loadPresetStrategy(paytableId: string, tier: Tier): Promise<string> {
  const load = files[key(paytableId, tier)];
  if (!load) throw new Error(`no preset strategy for ${paytableId} (${tier})`);
  return load();
}

/** Value of a `# key: value` header line, if present. */
export function strategyHeader(text: string, name: string): string | undefined {
  const prefix = `# ${name}: `;
  return text
    .split("\n")
    .find((l) => l.startsWith(prefix))
    ?.slice(prefix.length);
}

/** Strategy text for a pay table and level ("" if there is none). */
export async function loadLevel(custom: CustomStrategies, paytableId: string, level: Level): Promise<string> {
  if (level === "custom") return custom.get(paytableId)?.text ?? "";
  return hasPresetStrategy(paytableId, level) ? loadPresetStrategy(paytableId, level) : "";
}

/** Distinct rule lines of the preset strategies of these pay tables, in
 *  file notation (suggestions for the editor). */
export async function presetRules(paytableIds: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const id of paytableIds)
    for (const tier of ["beginner", "intermediate", "expert"] as Tier[])
      if (hasPresetStrategy(id, tier))
        for (const line of (await loadPresetStrategy(id, tier)).split("\n")) {
          const r = line.replace(/#.*/, "").trim();
          if (r) out.add(r);
        }
  return [...out].sort();
}
