//! Registers every JSON file under ../data/games and ../data/paytables as
//! built-in data, so adding a preset is pure data entry.

use std::fs;
use std::path::Path;

fn list(dir: &Path) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .map(|p| {
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            let abs = fs::canonicalize(&p).unwrap().to_string_lossy().into_owned();
            (name, abs)
        })
        .collect();
    v.sort();
    v
}

fn main() {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../data");
    println!("cargo:rerun-if-changed={}", data.display());
    let mut out = String::new();
    for (konst, sub) in [("GAMES", "games"), ("PAYTABLES", "paytables")] {
        let dir = data.join(sub);
        println!("cargo:rerun-if-changed={}", dir.display());
        out.push_str(&format!("pub const {konst}: &[(&str, &str)] = &[\n"));
        for (name, abs) in list(&dir) {
            println!("cargo:rerun-if-changed={abs}");
            out.push_str(&format!("    ({name:?}, include_str!({abs:?})),\n"));
        }
        out.push_str("];\n");
    }
    let dest = Path::new(&std::env::var("OUT_DIR").unwrap()).join("builtin_data.rs");
    fs::write(dest, out).unwrap();
}
