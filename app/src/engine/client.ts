// Promise-based client for the engine worker (UI-thread side).
import type { Request, ResponseData, WorkerReply } from "./protocol";

type Pending = { resolve: (d: ResponseData) => void; reject: (e: Error) => void };

export class EngineClient {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      const b = ev.data.body;
      if (b.ok) p.resolve(b.data);
      else p.reject(new Error(b.error));
    };
  }

  /** Stops the worker (e.g. to cancel a long generation). Pending requests
   *  fail; the client can't be used afterwards. */
  terminate() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error("cancelled"));
    this.pending.clear();
  }

  request<K extends Request["kind"]>(req: Extract<Request, { kind: K }>): Promise<Extract<ResponseData, { kind: K }>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (d: ResponseData) => void, reject });
      this.worker.postMessage({ id, body: req });
    });
  }
}
