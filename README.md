# Open Video Poker Trainer

A free, open-source video poker trainer. Not a gambling product. See
[SPEC.md](SPEC.md) for scope and [docs/progress.md](docs/progress.md) for status.

## Layout

| Path | What |
|---|---|
| `engine/` | Rust engine (no UI deps). Library + `ovp` CLI; compiles to WebAssembly. |
| `data/` | Game definitions and pay table libraries (JSON). Every file is compiled into the engine automatically; adding a preset is data entry. |
| `app/` | TypeScript + Vite browser app: the game (`index.html`) and an engine dev shell (`dev.html`). Heavy engine work runs in a Web Worker. Default keys: `app/src/config/keymap.ts`; timing, colors, layout: `app/src/config/feel.ts`; trainer defaults: `app/src/config/trainer.ts`. |
| `strategies/` | Generated strategies: one folder per preset pay table, `beginner/intermediate/expert.txt`. Format: [docs/strategy-format.md](docs/strategy-format.md). |
| `docs/` | Progress notes per milestone; strategy format. |

## Requirements

Rust (stable) with the `wasm32-unknown-unknown` target, `wasm-pack`, Node 22+.

## Commands

```sh
# Engine
cd engine
cargo test                          # unit tests + verification suite
cargo test -- --ignored             # also the full 52-card no-symmetry check
cargo run --release --bin ovp -- list               # games and preset pay tables
cargo run --release --bin ovp -- analyze            # 9/6 Jacks or Better, max bet
cargo run --release --bin ovp -- analyze --all      # every preset
cargo run --release --bin ovp -- analyze -p double-bonus-9-6 --bet 3
cargo run --release --bin ovp -- analyze --progressive 6000
cargo run --release --bin ovp -- analyze --set full_house=8 --set flush=5   # custom variant
cargo run --release --bin ovp -- holds "Js Ts 9s 2h 2d"
cargo run --release --bin ovp -- verify --all       # §3.3 suite for every game
cargo run --release --bin ovp -- strategy eval ../strategies/jacks-or-better-9-6/expert.txt
cargo run --release --bin ovp -- strategy play ../strategies/jacks-or-better-9-6/beginner.txt "Ah Kh Qh Jh 2c"
cargo run --release --bin ovp -- strategy generate -p bonus-poker-8-5 --tier intermediate
cargo run --release --bin ovp -- strategy generate -p double-double-bonus-8-5 --tier beginner --max-lines 20
cargo run --release --bin ovp -- strategy generate --all     # regenerate strategies/ (~20 min)

# App
cd app
npm install
npm test           # builds the wasm package, then runs vitest against it
npm run dev        # dev server: game at /, engine dev shell at /dev.html
npm run build      # static build in app/dist
```

## License

MIT — see [LICENSE](LICENSE).
