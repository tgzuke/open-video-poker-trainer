// Test helper: a 2D context that records draw calls.
/** A 2D context that records what is drawn. */
export class RecordingCtx {
  calls: string[] = [];
  fillStyle = "#000";
  imageSmoothingEnabled = true;
  canvas = { width: 1280, height: 720 };
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`${this.fillStyle} ${x} ${y} ${w} ${h}`);
  }
  drawImage(...a: unknown[]) {
    this.calls.push(`img ${a.slice(1).join(" ")}`);
  }
}

export function hash(lines: string[]): string {
  let h = 0x811c9dc5;
  for (const l of lines)
    for (let i = 0; i < l.length; i++) {
      h ^= l.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  return h.toString(16).padStart(8, "0");
}

