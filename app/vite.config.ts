import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths so the static build works from any folder (itch.io).
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022" },
  test: { include: ["test/**/*.test.ts"] },
});
