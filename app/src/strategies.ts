// Shipped preset strategies (generated offline by `ovp strategy generate --all`).
import type { Tier } from "./engine/protocol";

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
