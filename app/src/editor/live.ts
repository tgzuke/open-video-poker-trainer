// Runs the latest of a stream of requests: while one is in flight, newer
// requests replace each other and only the last one runs next. Results of
// requests that were overtaken are dropped. Used for live re-evaluation in
// the strategy editor (each edit is a request; the engine is ~1 s per run).

export class Latest<T> {
  private busy = false;
  private next: { key: string } | null = null;

  constructor(
    private readonly run: (key: string) => Promise<T>,
    private readonly done: (key: string, result: T) => void,
    private readonly failed: (key: string, error: Error) => void,
  ) {}

  get running(): boolean {
    return this.busy;
  }

  request(key: string) {
    this.next = { key };
    if (!this.busy) void this.pump();
  }

  /** Forget a queued request (the in-flight one still reports unless a
   *  newer request arrives). */
  clear() {
    this.next = null;
  }

  private async pump() {
    this.busy = true;
    while (this.next) {
      const { key } = this.next;
      this.next = null;
      try {
        const r = await this.run(key);
        if (!this.next) this.done(key, r);
      } catch (e) {
        if (!this.next) this.failed(key, e instanceof Error ? e : new Error(String(e)));
      }
    }
    this.busy = false;
  }
}
