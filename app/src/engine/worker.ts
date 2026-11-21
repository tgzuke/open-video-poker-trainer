// Web Worker: owns the WebAssembly engine so the UI thread never blocks.
import init, { Engine } from "../wasm/ovp_engine.js";
import { EngineHost } from "./core";
import type { Envelope, Request, WorkerReply } from "./protocol";

const ready = init();
const host = new EngineHost((id) => Engine.builtin(id));

self.onmessage = async (ev: MessageEvent<Envelope<Request>>) => {
  const { id, body } = ev.data;
  let reply: WorkerReply;
  try {
    await ready;
    reply = { id, body: { ok: true, data: host.handle(body) } };
  } catch (e) {
    reply = { id, body: { ok: false, error: e instanceof Error ? e.message : String(e) } };
  }
  self.postMessage(reply);
};
