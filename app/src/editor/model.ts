// Strategy editor model (SPEC §4.4): the rule list being edited, with
// validation and undo. No DOM; the dialog in ui/editor.ts drives it.
//
// The last line is always "discard everything" and can't be edited, moved
// or removed. Each other line holds what the player typed; it is checked
// with the engine's rule parser and stored in canonical notation.

export const DISCARD = "discard everything";
const UNDO_LIMIT = 200;

export interface Line {
  /** What is shown in the input (canonical once it parses). */
  text: string;
  /** Problem with this line, or null. */
  error: string | null;
  /** 0-based index of an earlier identical rule (this one never fires). */
  repeats: number | null;
}

/** Throws on an invalid rule; returns canonical text otherwise. */
export type RuleParser = (text: string) => string;

/** Rule lines of strategy file text (comments and blank lines dropped). */
export function ruleLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
}

export class EditorModel {
  private texts: string[] = [];
  private undoStack: string[][] = [];
  private savedSnapshot = "";
  lines: Line[] = [];

  constructor(private readonly parse: RuleParser) {
    this.load("");
  }

  /** Replace the list (from file text). A missing final "discard
   *  everything" is added; one elsewhere is dropped. Clears undo. */
  load(text: string) {
    const rules = ruleLines(text).filter((r) => r !== DISCARD);
    this.texts = rules.map((r) => this.canonical(r));
    this.undoStack = [];
    this.check();
    this.markSaved();
  }

  /** Replace the whole list as one undoable change. */
  replaceAll(text: string) {
    const rules = ruleLines(text).filter((r) => r !== DISCARD);
    this.change(() => (this.texts = rules.map((r) => this.canonical(r))));
  }

  /** Editable rules (without the final line). */
  get editable(): string[] {
    return this.texts;
  }

  /** Every rule including the final "discard everything". */
  rules(): string[] {
    return [...this.texts, DISCARD];
  }

  /** Strategy text to evaluate. */
  text(): string {
    return this.rules().join("\n") + "\n";
  }

  valid(): boolean {
    return this.lines.every((l) => !l.error);
  }

  firstError(): { line: number; error: string } | null {
    const i = this.lines.findIndex((l) => l.error);
    return i < 0 ? null : { line: i, error: this.lines[i].error! };
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get dirty(): boolean {
    return this.text() !== this.savedSnapshot;
  }

  markSaved() {
    this.savedSnapshot = this.text();
  }

  private canonical(t: string): string {
    try {
      return this.parse(t);
    } catch {
      return t.trim();
    }
  }

  private check() {
    this.lines = this.texts.map((t, i) => {
      let error: string | null = null;
      if (!t.trim()) error = "type a rule";
      else if (t.trim() === DISCARD) error = `"${DISCARD}" is always the last line`;
      else
        try {
          this.parse(t);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
      const first = this.texts.indexOf(t);
      return { text: t, error, repeats: !error && first < i ? first : null };
    });
    this.lines.push({ text: DISCARD, error: null, repeats: null });
  }

  private change(f: () => void) {
    this.undoStack.push([...this.texts]);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    f();
    this.check();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.texts = prev;
    this.check();
  }

  /** Is line i the fixed final line? */
  isFixed(i: number): boolean {
    return i === this.texts.length;
  }

  edit(i: number, text: string) {
    if (i < 0 || i >= this.texts.length) return;
    const t = this.canonical(text);
    if (t === this.texts[i]) return;
    this.change(() => (this.texts[i] = t));
  }

  /** Inserts a rule so that it becomes line i (at most just above the
   *  final line). Returns its index. */
  insert(i: number, text = ""): number {
    const at = Math.max(0, Math.min(i, this.texts.length));
    this.change(() => this.texts.splice(at, 0, text ? this.canonical(text) : ""));
    return at;
  }

  remove(i: number) {
    if (i < 0 || i >= this.texts.length) return;
    this.change(() => this.texts.splice(i, 1));
  }

  /** Moves line `from` so it becomes line `to` (both clamped above the
   *  final line). */
  move(from: number, to: number) {
    const n = this.texts.length;
    if (from < 0 || from >= n) return;
    const t = Math.max(0, Math.min(to, n - 1));
    if (t === from) return;
    this.change(() => {
      const [r] = this.texts.splice(from, 1);
      this.texts.splice(t, 0, r);
    });
  }
}
