import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import type { BuildEnvironmentOptions } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig(({ mode }) => ({
  // Relative asset paths so the static build works from any folder (itch.io).
  base: "./",
  worker: { format: "es" },
  // Preset strategies live in ../strategies (shared with the engine CLI).
  server: { fs: { allow: [".."] } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: (mode === "itch"
    ? // Release build for itch.io: the game page only (no engine dev shell).
      { target: "es2022", outDir: "dist-itch", emptyOutDir: true, rollupOptions: { input: { main: "index.html" } } }
    : { target: "es2022", rollupOptions: { input: { main: "index.html", dev: "dev.html" } } }) as BuildEnvironmentOptions,
  test: { include: ["test/**/*.test.ts"] },
}));
