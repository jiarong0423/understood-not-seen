// Run: node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { classify, runGate } from "../web/js/gate.js";
import { rankActivities } from "../web/js/combine.js";
import { readFileSync } from "node:fs";

const mk = (url, title = "", folders = []) => ({ url, title, folders });
test("rule parity with filter_bookmarks.py self-test", () => {
  assert.equal(classify(mk("https://www.youtube.com/watch?v=abc", "Radiohead - Live")), null);
  assert.equal(classify(mk("https://en.wikipedia.org/wiki/Jazz", "Jazz - Wikipedia")), null);
  assert.equal(classify(mk("https://www.pornhub.com/view_video", "x")), "adult");
  assert.equal(classify(mk("https://example.com/a", "free 無碼 stuff")), "adult");
  assert.equal(classify(mk("https://www.youtube.com/watch?v=1", "some r18 compilation")), "adult");
  assert.equal(classify(mk("https://www.youtube.com/watch?v=1", "ok title", ["成人"])), "adult");
  assert.equal(classify(mk("https://mybank.com/login", "Bank")), "personal_or_account");
  assert.equal(classify(mk("https://www.facebook.com/someone", "profile")), "personal_or_account");
  assert.equal(classify(mk("http://192.168.0.1/admin", "router")), "private_host");
  assert.equal(classify(mk("chrome://settings", "Settings")), "non_web_scheme");
  assert.equal(classify(mk("https://www.youtube.com/watch?v=1&token=zzz", "t")), "sensitive_query");
  assert.equal(classify(mk("https://www.sussex.ac.uk/", "Sussex Uni")), null); // not allowlist-gated in the browser funnel
  // substring false positives that used to remove ordinary pages
  assert.equal(classify(mk("https://www.youtube.com/watch?v=1", "Badminton doubles tactics")), null);
  assert.equal(classify(mk("https://www.youtube.com/watch?v=2", "JavaScript tutorial for beginners")), null);
  assert.equal(classify(mk("https://www.youtube.com/watch?v=3", "Milford Sound travel guide")), null);
  assert.equal(classify(mk("https://www.eater.com/x", "Updating the menu at an association dinner")), null);
  assert.equal(classify(mk("https://example.com/admin/panel", "Admin panel")), "personal_or_account");
  // real false positives found in a user's own bookmarks
  assert.equal(classify(mk("https://www.94itv.net/x", "Gunpowder Milkshake 火藥奶昔線上看")), null);
  assert.equal(classify(mk("https://today.line.me/tw/v2/article/x", "功夫菜 recipe")), null);
  assert.equal(classify(mk("https://blog.example.com/physio", "Physiotherapy Clinic: common badminton injuries")), null);
  assert.equal(classify(mk("https://line.me/R/ti/p/abc", "Add me on LINE")), "personal_or_account");
  assert.equal(classify(mk("https://clinic.example.org/patient/login", "Clinic")), "personal_or_account");
  assert.equal(classify(mk("https://www.example.com/a", "財富密碼: how to think about compounding")), null);
  assert.equal(classify(mk("https://www.example.com/b", "忘記密碼")), "personal_or_account");
  assert.equal(classify(mk("https://www.fsc.example.gov.tw/x", "Securities filings status lookup")), null);
});
test("contagion by account page affects only that exact host; adult contagion still covers the whole site", () => {
  const items = [mk("https://accounts.google.com/signin", "Sign in"), mk("https://www.google.com/finance/x", "Market column")];
  const sameHost = [mk("https://www.google.com/amp/s/a.com/x", "忘記密碼"), mk("https://www.google.com/search?q=lunch", "lunch search"), mk("https://www.google.com/amp/s/b.com/y", "market column")];
  assert.equal(runGate(sameHost).kept.length, 1, "only the same path group is tainted");
  assert.equal(runGate(items).kept.length, 1);
  const adult = [mk("https://cn.some-adult-site.com/a", "porn clip"), mk("https://www.some-adult-site.com/b", "ok page")];
  assert.equal(runGate(adult).kept.length, 0);
  const shared = [mk("https://www.google.com/search?q=porn", "porn"), mk("https://www.google.com/amp/s/a.com/x", "market column"), mk("https://www.google.com/search?q=lunch", "lunch")];
  assert.equal(runGate(shared).kept.length, 1, "on a shared site only the same path group is tainted");
});
test("contagion: flagged domain removes its neighbours; big platforms only the flagged item", () => {
  const a = [mk("https://some-site.example.org/a", "ok"), mk("https://some-site.example.org/b", "porn clip")];
  assert.equal(runGate(a).kept.length, 0);
  const b = [mk("https://www.youtube.com/watch?v=1", "ok"), mk("https://www.youtube.com/watch?v=2", "porn clip")];
  assert.equal(runGate(b).kept.length, 1);
});
test("ranking: keyword hits and chosen needs", () => {
  const kb = JSON.parse(readFileSync(new URL("../web/kb/activities.json", import.meta.url))).filter((x) => x.tag_id);
  const items = [{ title: "Badminton doubles tactics", host: "youtube.com" }, { title: "Fed rate decision", host: "bloomberg.com" }];
  const r = rankActivities(items, kb, []);
  assert.equal(r[0].activity, "Badminton court");
  assert.ok(!r.some((x) => x.activity === "Golf course"), "finance reading must not create a golf idea");
  const r2 = rankActivities(items, kb, ["business_talk"]);
  assert.ok(r2.some((x) => x.activity === "Golf course"), "visitor-chosen need adds golf");
});

test("Chinese titles match activities (Traditional and Simplified) and the gate still blocks Chinese adult terms", () => {
  const kb = JSON.parse(readFileSync(new URL("../web/kb/activities.json", import.meta.url))).filter((x) => x.tag_id);
  const names = (titles) => rankActivities(titles.map((t) => ({ title: t, host: "youtube.com" })), kb, []).map((x) => x.activity);
  assert.ok(names(["羽球雙打戰術教學"]).includes("Badminton court"));
  assert.ok(names(["羽毛球双打技巧"]).includes("Badminton court"));
  assert.ok(names(["皮拉提斯入門課程"]).includes("Pilates studio"));
  assert.ok(names(["高尔夫挥杆基本功"]).includes("Golf course"));
  assert.ok(names(["台北無菜單日料推薦"]).includes("Fine dining restaurant"));
  assert.ok(names(["十月音樂會節目表"]).includes("Concert hall"));
  assert.equal(classify(mk("https://example.com/x", "免費無碼影片")), "adult");
});
test("every activity has a Chinese name and every need has both labels", () => {
  const kb = JSON.parse(readFileSync(new URL("../web/kb/activities.json", import.meta.url))).filter((x) => x.tag_id);
  const i18n = JSON.parse(readFileSync(new URL("../web/kb/i18n.json", import.meta.url)));
  for (const a of kb) assert.ok(i18n.activities[a.activity]?.zh, "missing zh for " + a.activity);
  const needs = new Set(kb.flatMap((a) => a.functions));
  for (const n of needs) assert.ok(i18n.needs[n]?.en && i18n.needs[n]?.zh, "missing label for " + n);
});

import { waiting } from "../web/js/waiting.js";
test("saved-a-while-ago: oldest old-enough bookmark of a ticked idea; unknown dates and recent saves are ignored", () => {
  const DAY = 86400000, now = Date.UTC(2026, 9, 11);
  const kbRows = [{ activity: "Pickleball court", keywords: ["pickleball"], functions: ["social"] }, { activity: "Golf course", keywords: ["golf"], functions: ["business_talk"] }];
  const items = [
    { title: "Pickleball rules", host: "x.com", added: now - 430 * DAY }, { title: "Pickleball paddles", host: "x.com", added: now - 20 * DAY },
    { title: "Golf swing basics", host: "x.com", added: now - 10 * DAY }, { title: "Pickleball drills", host: "x.com", added: 0 },
  ];
  const w = waiting(items, [{ activity: "Pickleball court", on: true }, { activity: "Golf course", on: true }], kbRows, now);
  assert.equal(w.length, 1); assert.equal(w[0].activity, "Pickleball court"); assert.equal(w[0].months, 14); assert.equal(w[0].title, "Pickleball rules");
  assert.deepEqual(waiting(items, [{ activity: "Pickleball court", on: false }], kbRows, now), []);
});
