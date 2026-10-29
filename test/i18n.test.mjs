// Language mapping audit: every string exists in English and Traditional Chinese, English never contains Chinese,
// Chinese is really Chinese (only proper nouns and technical terms may stay in Latin letters).
// Run: node --test test/i18n.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const i18n = load("../web/kb/i18n.json");
const cal = load("../web/kb/calendar.json");
const kb = load("../web/kb/activities.json").filter((a) => a.tag_id);
const CJK = /[一-鿿]/, LATIN_WORD = /[A-Za-z]{3,}/;
const OK_LATIN = /^(Qloo|Chrome|API|MIT|PWA|JSON|CRT|Alt\+S|Y2K|Risograph|KTV|Live|House|Google|LINE|SPA|WebAssembly|English|cdn\.jsdelivr\.net|huggingface\.co|heatmap|true)$/i;
const latinLeft = (zh) => (zh.replace(/\{[a-z]+\}/g, "").match(/[A-Za-z][A-Za-z0-9+.'-]*/g) || []).filter((w) => w.length >= 3 && !OK_LATIN.test(w));

// themes menu labels and a few interface terms are named in the theme file, not in i18n.json
const pairs = [];
for (const [k, v] of Object.entries(i18n.ui)) pairs.push([`ui.${k}`, v]);
for (const [k, v] of Object.entries(i18n.needs)) pairs.push([`needs.${k}`, v]);
for (const [k, v] of Object.entries(i18n.reasons || {})) pairs.push([`reasons.${k}`, v]);
for (const [k, v] of Object.entries(i18n.invite.verbs)) pairs.push([`invite.verbs.${k}`, v]);
for (const [k, v] of Object.entries(i18n.invite.hooks)) pairs.push([`invite.hooks.${k}`, v]);
for (const e of cal.entries) { pairs.push([`cal.${e.id}`, { zh: e.zh, en: e.en }]); pairs.push([`cal.${e.id}.ritual`, e.ritual]); if (e.prep) pairs.push([`cal.${e.id}.prep`, e.prep]); }
for (const a of kb) pairs.push([`activity.${a.activity}`, { en: a.activity, zh: i18n.activities[a.activity]?.zh }]);

test("every string has both languages", () => {
  assert.deepEqual(pairs.filter(([, v]) => !v || !v.en || !v.zh).map(([k]) => k), []);
});
test("English strings contain no Chinese (the language toggle label is the only exception)", () => {
  assert.deepEqual(pairs.filter(([k, v]) => v && v.en && CJK.test(v.en) && k !== "ui.lang").map(([k]) => k), []);
});
test("Chinese strings are Chinese: they contain Chinese and no stray English words", () => {
  const needsCjk = (z) => { const rest = z.replace(/\{[a-z]+\}/g, "").replace(/[\s：:（）()·,，.。\-–]/g, ""); return rest.length > 0 && !OK_LATIN.test(rest); };
  const noCjk = pairs.filter(([k, v]) => v && v.zh && !CJK.test(v.zh) && needsCjk(v.zh) && k !== "ui.lang").map(([k, v]) => `${k}: ${v.zh}`);
  assert.deepEqual(noCjk, []);
  const stray = pairs.map(([k, v]) => [k, v && v.zh ? latinLeft(v.zh) : []]).filter(([, w]) => w.length).map(([k, w]) => `${k}: ${w.join(" ")}`);
  assert.deepEqual(stray, []);
});
test("placeholders match in both languages", () => {
  const ph = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join();
  assert.deepEqual(pairs.filter(([, v]) => v && v.en && v.zh && ph(v.en) !== ph(v.zh)).map(([k]) => k), []);
});
