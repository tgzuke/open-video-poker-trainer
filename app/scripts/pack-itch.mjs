// Packs app/dist-itch into release/open-video-poker-trainer-<version>-html5.zip
// with index.html at the zip root (itch.io's HTML5 requirement), after
// checking itch.io's limits and that no dev-only page slipped in.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const app = new URL("..", import.meta.url).pathname;
const dist = join(app, "dist-itch");
const { version } = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));

const files = [];
const walk = (d) =>
  readdirSync(d).forEach((f) => {
    const p = join(d, f);
    statSync(p).isDirectory() ? walk(p) : files.push(relative(dist, p));
  });
walk(dist);

const fail = (msg) => {
  console.error(`pack-itch: ${msg}`);
  process.exit(1);
};
if (!files.includes("index.html")) fail("index.html missing from the build root");
if (files.some((f) => /(^|\/)dev\.html$/.test(f))) fail("dev.html is in the release build");
if (files.length > 1000) fail(`${files.length} files; itch.io allows 1000`);
const bytes = files.reduce((n, f) => n + statSync(join(dist, f)).size, 0);
if (bytes > 200 * 1024 * 1024) fail("build exceeds 200 MB");
if (!files.some((f) => f.endsWith(".wasm"))) fail("no .wasm in the build");
const html = readFileSync(join(dist, "index.html"), "utf8");
if (/(src|href)="\//.test(html)) fail("index.html uses absolute paths; itch.io serves from a subfolder");

const outDir = join(app, "..", "release");
mkdirSync(outDir, { recursive: true });
const zip = join(outDir, `open-video-poker-trainer-${version}-html5.zip`);
rmSync(zip, { force: true });
execFileSync("zip", ["-q", "-r", "-X", zip, "."], { cwd: dist });
console.log(`${zip}\n${files.length} files, ${(bytes / 1024).toFixed(0)} kB unpacked, ${(statSync(zip).size / 1024).toFixed(0)} kB zipped`);
