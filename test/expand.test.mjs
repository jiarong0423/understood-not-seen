// Expansion suggestions: the hand-made table only names real activities, suggestions never repeat an idea,
// the "balance" path never returns an activity serving the same need, results are stable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expand, PATHS } from "../web/js/expand.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const kb = load("../web/kb/activities.json").filter((a) => a.tag_id);
const exp = load("../kb/expansion.json");
const i18n = load("../web/kb/i18n.json");
const names = new Set(kb.map((a) => a.activity));
const src = (...a) => a.map((activity) => ({ activity }));

test("every name in the expansion table is an activity that exists and can be queried", () => {
  const all = [...Object.values(exp.families).flat(), ...Object.values(exp.goes_with).flat(), ...Object.keys(exp.goes_with)];
  assert.deepEqual(all.filter((n) => !names.has(n)), []);
  for (const needs of Object.values(exp.balance)) for (const n of needs) assert.ok(i18n.needs[n], "unknown need " + n);
  assert.deepEqual(Object.keys(exp.balance).filter((n) => !i18n.needs[n]), []);
});
test("path labels exist in both languages", () => {
  for (const p of PATHS) for (const l of ["en", "zh"]) assert.ok(i18n.ui["path_" + p]?.[l], p + " " + l);
});
test("suggestions never repeat the ticked ideas, never use fallback-only activities, at most 6, stable", () => {
  for (const s of [["Badminton court"], ["Fishing store", "Coffee shop"], ["Gym", "Hiking area", "Book store"], ["Golf course"]]) {
    const a = expand(src(...s), kb, exp), b = expand(src(...s), kb, exp);
    assert.deepEqual(a, b);
    assert.ok(a.length > 0 && a.length <= 6, s.join() + " gave " + a.length);
    assert.equal(new Set(a.map((x) => x.activity)).size, a.length, "duplicate suggestion");
    for (const x of a) {
      assert.ok(!s.includes(x.activity), x.activity + " is already an idea");
      assert.ok(!kb.find((k) => k.activity === x.activity).fallback_only);
      assert.ok(x.tag_id && s.includes(x.from));
    }
  }
});
test("the balance path returns activities that serve a different need than the source", () => {
  for (const s of ["Gym", "Golf course", "Concert hall", "Boutique", "Karaoke bar"]) {
    const from = kb.find((k) => k.activity === s);
    for (const x of expand(src(s), kb, exp, 6).filter((x) => x.path === "balance")) {
      const to = kb.find((k) => k.activity === x.activity);
      assert.ok(!to.functions.some((f) => from.functions.includes(f)), `${s} -> ${x.activity} shares a need`);
    }
  }
});
test("nothing to suggest when nothing is ticked", () => assert.deepEqual(expand([], kb, exp), []));

test("weekend invitations: every need has a verb phrase in both languages; hooks name real activities; templates have their slots", () => {
  for (const n of Object.keys(i18n.needs)) for (const l of ["en", "zh"]) assert.ok(i18n.invite.verbs[n]?.[l], n + " " + l);
  for (const h of Object.keys(i18n.invite.hooks)) { assert.ok(names.has(h), h); const n = i18n.invite.hooks[h].need; if (n) assert.ok(i18n.needs[n], h + " need " + n); }
  for (const l of ["en", "zh"]) {
    assert.ok(i18n.ui.invite_one[l].includes("{verb}") && i18n.ui.invite_one[l].includes("{a}"));
    assert.ok(i18n.ui.invite_two[l].includes("{a}") && i18n.ui.invite_two[l].includes("{b}"));
    assert.ok(i18n.ui.invite_more_one[l].includes("{a}") && i18n.ui.invite_more_two[l].includes("{b}"));
  }
});
