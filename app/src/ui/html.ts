// Small HTML helpers shared by the editor and comparison dialogs.

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const SUIT: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };

/** A hand ("2c Td Jd Qd Ac") with the held cards (mask bit i = card i)
 *  bright and the discards dim. */
export function cardsHtml(hand: string, held: number): string {
  return hand
    .split(" ")
    .map((c, i) => {
      const rank = c.slice(0, -1).replace("T", "10");
      const suit = c.slice(-1);
      const cls = `card ${suit === "h" || suit === "d" ? "red" : "black"} ${held >> i & 1 ? "held" : "out"}`;
      return `<span class="${cls}">${esc(rank)}${SUIT[suit] ?? esc(suit)}</span>`;
    })
    .join("");
}

/** Signed fixed-point number ("+0.0012", "−0.0012", "0.0000"). */
export function signed(x: number, digits: number): string {
  const s = Math.abs(x).toFixed(digits);
  if (Number(s) === 0) return s;
  return `${x > 0 ? "+" : "−"}${s}`;
}

/** Download text as a file. */
export function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
