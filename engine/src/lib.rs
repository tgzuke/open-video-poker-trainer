//! Open Video Poker Trainer engine.
//!
//! Pure computation with no UI dependencies: hand evaluation, exact hold EVs,
//! and full-game analysis. Used natively by the `ovp` CLI and in the browser
//! through WebAssembly (`wasm` module, wasm32 only).

pub mod analysis;
pub mod cards;
pub mod combin;
pub mod draw;
pub mod eval;
pub mod game;
pub mod verify;

#[cfg(target_arch = "wasm32")]
pub mod wasm;
