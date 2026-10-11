// PWA: the manifest is complete, its icons exist at the sizes it claims, and every file the service worker precaches exists.
// Run: node --test test/pwa.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const web = (p) => new URL("../web/" + p, import.meta.url);
const man = JSON.parse(readFileSync(web("manifest.webmanifest")));
const png = (p) => { const b = readFileSync(web(p)); assert.equal(b.subarray(1, 4).toString(), "PNG", p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("manifest has what browsers need to offer an install", () => {
  for (const k of ["name", "short_name", "start_url", "scope", "display", "theme_color", "background_color", "icons"]) assert.ok(man[k], k);
  assert.equal(man.display, "standalone");
  assert.ok(man.icons.some((i) => i.sizes === "192x192") && man.icons.some((i) => i.sizes === "512x512"), "192 and 512 icons");
  assert.ok(man.icons.some((i) => i.purpose === "maskable"), "a maskable icon");
});
test("icons exist and are the size the manifest says", () => {
  for (const i of man.icons.filter((x) => x.type === "image/png")) {
    const [w, h] = png(i.src); assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
  assert.deepEqual(png("icons/apple-touch-icon.png"), [180, 180]);
});
test("service worker: every precached file exists; /api is never cached; page links manifest and icons", () => {
  const sw = readFileSync(web("sw.js"), "utf8");
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(shell.length >= 4 && shell.length <= 10, "a small install: the rest is stored on first use");
  assert.deepEqual(shell.filter((f) => f !== "./" && !existsSync(web(f))), []);
  assert.match(sw, /startsWith\("\/api\/"\)/);
  const html = readFileSync(web("index.html"), "utf8");
  for (const s of ['rel="manifest"', 'rel="apple-touch-icon"', 'name="theme-color"']) assert.ok(html.includes(s), s);
  assert.match(readFileSync(web("js/app.js"), "utf8"), /serviceWorker\.register\("sw\.js"\)/);
});

test("release id is the same in the page, the code and the service worker", () => {
  const html = readFileSync(web("index.html"), "utf8"), app = readFileSync(web("js/app.js"), "utf8"), sw = readFileSync(web("sw.js"), "utf8");
  const a = html.match(/<meta name="build" content="([^"]+)">/)[1], b = app.match(/const BUILD = "([^"]+)"/)[1], c = sw.match(/const VERSION = "uns-([^"]+)"/)[1];
  assert.equal(a, b); assert.equal(b, c);
  assert.doesNotMatch(sw, /clients\.claim\(\)/, "a new worker must not take over a page that is still loading");
});
