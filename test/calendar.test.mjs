// Calendar: dates are valid and weekday-consistent, every occasion names real activities, Taiwan entries are shown only for Taiwan cities.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { upcoming, weekSeed, rotate } from "../web/js/calendar.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const cal = load("../web/kb/calendar.json");
const kb = new Set(load("../web/kb/activities.json").filter((a) => a.tag_id).map((a) => a.activity));
const cities = load("../web/kb/cities.json").cities.map((c) => c.en);
const i18n = load("../web/kb/i18n.json");

test("entries are well formed: ISO dates in order, bilingual names, real activities, known region", () => {
  const ids = new Set();
  for (const e of cal.entries) {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.start) && /^\d{4}-\d{2}-\d{2}$/.test(e.end) && e.start <= e.end, e.id);
    assert.ok(e.zh && e.en && ["TW", "INTL"].includes(e.region) && ["holiday", "observance"].includes(e.kind), e.id);
    assert.ok(!ids.has(e.id), "duplicate " + e.id); ids.add(e.id);
    for (const a of e.acts) assert.ok(kb.has(a), e.id + " " + a);
  }
  assert.deepEqual(cal.non_tw_cities.filter((c) => !cities.includes(c)), []);
  for (const k of ["path_occasion", "occasion_line", "occasion_in", "occasion_now"]) for (const l of ["en", "zh"]) assert.ok(i18n.ui[k][l], k);
});
test("known anchors: Taiwan long weekends fall on the official days; Easter 2027 is a Sunday; Constitution Day 2026 starts Friday", () => {
  const by = Object.fromEntries(cal.entries.map((e) => [e.id, e]));
  const wd = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
  assert.equal(wd(by["tw-2026-guangfu"].start), 6); assert.equal(wd(by["tw-2026-guangfu"].end), 1);
  assert.equal(wd(by["tw-2026-xingxian"].start), 5); assert.equal(wd(by["tw-2026-xingxian"].end), 0);
  assert.equal(wd(by["intl-2027-easter"].start), 0);
  assert.equal(by["tw-2027-cny"].start, "2027-02-04"); assert.equal(by["tw-2027-cny"].end, "2027-02-10");
});
test("upcoming: next entry within the window; on-now gives 0 days; Taiwan entries hidden for other cities", () => {
  const a = upcoming(cal, "2026-10-11", "Taipei");
  assert.equal(a.entry.id, "tw-2026-guangfu"); assert.equal(a.days, 13);
  assert.equal(upcoming(cal, "2026-10-25", "Taipei").days, 0);
  const b = upcoming(cal, "2026-10-11", "Tokyo");
  assert.equal(b.entry.id, "intl-2026-halloween"); assert.equal(b.days, 20);
  assert.equal(upcoming(cal, "2026-10-11", "Tokyo", 5), null);
  assert.equal(upcoming(cal, "2030-01-01", "Taipei"), null);
});

test("every occasion has a ritual line in both languages; weekly rotation is stable within a week and changes the next week", () => {
  for (const e of cal.entries) for (const l of ["en", "zh"]) assert.ok(e.ritual?.[l] && e.ritual[l].length > 10, e.id + " " + l);
  for (const k of ["mode_calendar", "mode_weekly", "ritual_label"]) for (const l of ["en", "zh"]) assert.ok(i18n.ui[k][l], k);
  assert.equal(weekSeed("2026-10-12"), weekSeed("2026-10-18"));
  assert.equal(weekSeed("2026-10-19"), weekSeed("2026-10-12") + 1);
  assert.deepEqual(rotate([1, 2, 3], 0), [1, 2, 3]); assert.deepEqual(rotate([1, 2, 3], 4), [2, 3, 1]); assert.deepEqual(rotate([], 3), []);
});

test("lead-time reminders exist in both languages where given, and name real activities", () => {
  const withPrep = cal.entries.filter((e) => e.prep);
  assert.ok(withPrep.length >= 3);
  for (const e of withPrep) for (const l of ["en", "zh"]) assert.ok(e.prep[l] && e.prep[l].length > 10, e.id + " " + l);
  assert.ok(i18n.ui.prep_label.en && i18n.ui.prep_label.zh);
});
