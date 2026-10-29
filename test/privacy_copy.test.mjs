// The page must say exactly what leaves the device, in every place it makes a claim. Run: node --test test/privacy_copy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const ui = JSON.parse(read("../web/kb/i18n.json")).ui;
const html = read("../web/index.html"), readme = read("../README.md"), manifest = read("../web/manifest.webmanifest");

test("no claim says nothing is uploaded or that nothing leaves: ticked place names do go to Qloo", () => {
  const banned = /nothing is uploaded|never leave your browser|never leaves? your device|不會上傳任何書籤|沒有東西離開/i;
  for (const [name, text] of [["index.html", html], ["README", readme], ["manifest", manifest], ["i18n", JSON.stringify(ui)]]) assert.doesNotMatch(text, banned, name);
  for (const k of Object.keys(ui)) for (const l of ["en", "zh"]) assert.doesNotMatch(ui[k][l], /nothing is uploaded|never leave your browser|不會上傳任何書籤/i, `${k}.${l}`);
});
test("subtitle, meta description, manifest and README use the same precise sentence: file never uploaded; city, category ids and ticked names go to Qloo", () => {
  assert.equal(ui.sub.en, "Your bookmarks are read in this tab and never uploaded; only the city, place-category ids and the saved place names you tick are sent to Qloo.");
  assert.match(ui.sub.zh, /不會上傳/); assert.match(ui.sub.zh, /勾選/); assert.match(ui.sub.zh, /Qloo/);
  for (const [name, text] of [["meta", html], ["manifest", manifest]]) assert.match(text, /never uploaded; only a city, place-category ids and the place names you tick are sent to Qloo/, name);
  assert.match(readme, /never uploaded; only a city, place-category ids and the saved place names you tick are sent to Qloo/);
  assert.equal(ui.badge2.en, "Bookmark file never uploaded");
});
test("the other requests the page makes are listed next to the consent box, in both languages", () => {
  assert.match(html, /id="otherReq"/);
  for (const l of ["en", "zh"]) for (const host of ["cdn.jsdelivr.net", "huggingface.co", "Google"]) assert.ok(ui.other_body[l].includes(host), `${l} ${host}`);
  assert.ok(ui.other_title.en && ui.other_title.zh);
  const js = read("../web/js/embed.js") + read("../web/js/app.js");
  const hosts = new Set([...js.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]));
  for (const h of hosts) assert.ok(["cdn.jsdelivr.net", "maps.google.com", "www.google.com"].includes(h), "an undeclared host in the page code: " + h);
});
test("the gate limit is stated as a measurement", () => {
  assert.match(readme, /The gate is rule-based; on the sample it kept 29 of 35 links \(6 removed\); review the kept count\./);
  const links = [...read("../web/sample_bookmarks.html").matchAll(/<A /g)].length;
  assert.equal(links, 35);
  for (const n of ["i18n.json", "activities.json"]) assert.equal(read("../kb/" + n), read("../web/kb/" + n), "kb/" + n + " must match the served web/kb/" + n);
});
test("the data-flow diagram caption names the ticked place names too, in both languages and in the page's own fallback text", () => {
  assert.match(ui.diag_note.en, /place names you tick/); assert.match(ui.diag_note.zh, /勾選/);
  assert.match(html, /data-i18n="diag_note">Only a city, place-category ids and the place names you tick go out\./);
});
