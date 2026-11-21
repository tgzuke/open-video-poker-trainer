# Open Video Poker Trainer

A free, open-source video poker trainer. Not a gambling product. See
[SPEC.md](SPEC.md) for scope and [docs/progress.md](docs/progress.md) for status.

## Layout

| Path | What |
|---|---|
| `engine/` | Rust engine (no UI deps). Library + `ovp` CLI; compiles to WebAssembly. |
| `data/` | Game definitions and pay tables (JSON). Compiled into the engine. |
| `app/` | TypeScript + Vite browser app. The engine runs in a Web Worker. |
| `docs/` | Progress notes per milestone. |

## Requirements

Rust (stable) with the `wasm32-unknown-unknown` target, `wasm-pack`, Node 22+.

## Commands

```sh
# Engine
cd engine
cargo test                          # unit tests + verification suite
cargo test -- --ignored             # also the full 52-card no-symmetry check
cargo run --release --bin ovp -- analyze            # 9/6 Jacks or Better, max bet
cargo run --release --bin ovp -- holds "Js Ts 9s 2h 2d"
cargo run --release --bin ovp -- verify --full      # whole §3.3 suite

# App
cd app
npm install
npm test           # builds the wasm package, then runs vitest against it
npm run dev        # dev server
npm run build      # static build in app/dist
```

## License

MIT — see [LICENSE](LICENSE).
