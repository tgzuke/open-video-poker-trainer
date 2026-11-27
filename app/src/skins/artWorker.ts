// Web Worker: generates the Default theme's card art (pure data: rows of
// palette keys) off the UI thread, so the first deal never waits on it.
import { BACKS } from "./art/backs";
import { backArt, faceRows } from "./default";

export interface ArtReply {
  faces: [number, string[]][];
  backs: [string, string[]][];
  ms: number;
}

self.onmessage = () => {
  const t = performance.now();
  const faces: [number, string[]][] = [];
  for (let suit = 0; suit < 4; suit++) for (let rank = 2; rank <= 14; rank++) faces.push([rank * 4 + suit, faceRows(rank, suit)]);
  const backs: [string, string[]][] = BACKS.map((d) => [d.id, backArt(d)]);
  (self as unknown as Worker).postMessage({ faces, backs, ms: performance.now() - t } satisfies ArtReply);
};
