// Strategy view controller: open/close, scrolling, tier tabs. Drawing is in
// render/strategyView.ts. Navigation inside the view is mouse- or
// arrow-key-driven, like the menus (SPEC §6.4); opening it is a button
// of the input layer ("strategy", default S).
import { LEVELS, type Level } from "../engine/protocol";
import type { Pix } from "../render/pix";
import { CLOSE_RECT, VISIBLE_ROWS, drawStrategyView, inRect, maxScroll, tabRect, type StrategyContent } from "../render/strategyView";

export interface StrategyScreenHost {
  /** Rules (file text) of a level for the current pay table; "" if none. */
  loadText(tier: Level): Promise<string>;
  tier(): Level;
  setTier(t: Level): void;
  title(): string;
  summary(text: string): string;
  closeKey(): string;
  /** Redraw the screen. */
  redraw(): void;
}

export function rulesOf(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
}

export class StrategyScreen {
  open = false;
  scroll = 0;
  private texts = new Map<string, string>();
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(private host: StrategyScreenHost) {}

  /** Forget loaded texts (the pay table changed, or the player saved a
   *  strategy of their own). */
  reset() {
    this.texts.clear();
    this.scroll = 0;
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    this.open = true;
    this.scroll = 0;
    window.addEventListener("keydown", this.keyHandler, true);
    this.ensure(this.host.tier());
    this.host.redraw();
  }

  close() {
    this.open = false;
    window.removeEventListener("keydown", this.keyHandler, true);
    this.host.redraw();
  }

  private key(tier: Level) {
    return `${this.host.title()}|${tier}`;
  }

  private ensure(tier: Level) {
    const k = this.key(tier);
    if (this.texts.has(k)) return;
    void this.host.loadText(tier).then(
      (t) => {
        this.texts.set(k, t);
        this.host.redraw();
      },
      () => {
        this.texts.set(k, "");
        this.host.redraw();
      },
    );
  }

  content(): StrategyContent {
    const tier = this.host.tier();
    const text = this.texts.get(this.key(tier));
    return {
      title: this.host.title(),
      tier,
      rules: text === undefined ? null : rulesOf(text),
      summary: text ? this.host.summary(text) : "",
      closeKey: this.host.closeKey(),
    };
  }

  draw = (p: Pix) => {
    if (this.open) drawStrategyView(p, this.content(), this.scroll);
  };

  selectTier(t: Level) {
    if (t !== this.host.tier()) this.host.setTier(t);
    this.scroll = 0;
    this.ensure(t);
    this.host.redraw();
  }

  scrollBy(rows: number) {
    const max = maxScroll(this.content().rules);
    this.scroll = Math.max(0, Math.min(max, this.scroll + rows));
    this.host.redraw();
  }

  /** Click in logical screen coordinates; true if handled. */
  click(x: number, y: number): boolean {
    if (!this.open) return false;
    if (inRect(CLOSE_RECT, x, y)) this.close();
    else {
      const i = LEVELS.findIndex((_, k) => inRect(tabRect(k), x, y));
      if (i >= 0) this.selectTier(LEVELS[i]);
    }
    return true;
  }

  private onKey(e: KeyboardEvent) {
    if (!this.open || e.altKey || e.ctrlKey || e.metaKey) return;
    const tierIndex = LEVELS.indexOf(this.host.tier());
    const handled: Record<string, () => void> = {
      Escape: () => this.close(),
      ArrowUp: () => this.scrollBy(-1),
      ArrowDown: () => this.scrollBy(1),
      PageUp: () => this.scrollBy(-VISIBLE_ROWS),
      PageDown: () => this.scrollBy(VISIBLE_ROWS),
      Home: () => this.scrollBy(-1e6),
      End: () => this.scrollBy(1e6),
      ArrowLeft: () => this.selectTier(LEVELS[Math.max(0, tierIndex - 1)]),
      ArrowRight: () => this.selectTier(LEVELS[Math.min(LEVELS.length - 1, tierIndex + 1)]),
    };
    const f = handled[e.code];
    if (!f) return; // the strategy key itself reaches the keyboard source
    e.preventDefault();
    e.stopPropagation();
    f();
  }
}
