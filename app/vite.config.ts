import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths so the static build works from any folder (itch.io).
  base: "./",
  worker: { format: "es" },
  // Preset strategies live in ../strategies (shared with the engine CLI).
  server: { fs: { allow: [".."] } },
  build: { target: "es2022" },
  test: { include: ["test/**/*.test.ts"] },
});
