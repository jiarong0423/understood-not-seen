// Routing audit of the mapping table: keyword -> activity -> zh name -> needs -> tag id.
// Run: node --test test/routing.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankActivities } from "../web/js/combine.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const kb = load("../web/kb/activities.json").filter((a) => a.tag_id);
const all = load("../web/kb/activities.json");
const i18n = load("../web/kb/i18n.json");
const hit = (title) => rankActivities([{ title, host: "example.com" }], kb, []).map((r) => r.activity);

test("structure: every activity has tag id, zh name, keywords, valid needs", () => {
  const needs = new Set(Object.keys(i18n.needs));
  const bad = [];
  for (const a of kb) {
    if (!/^urn:tag:[a-z_]+:place(?::[a-z0-9_]+){1,2}$/.test(a.tag_id)) bad.push(a.activity + ": tag id format");
    if (!i18n.activities[a.activity]?.zh) bad.push(a.activity + ": zh name");
    if (!a.fallback_only) {
      if (!a.keywords?.length) bad.push(a.activity + ": no keywords");
      if (!a.keywords?.some((k) => /[a-z]/i.test(k))) bad.push(a.activity + ": no English keyword");
      if (!a.keywords?.some((k) => /[一-鿿]/.test(k))) bad.push(a.activity + ": no Chinese keyword");
    }
    for (const f of a.functions) if (!needs.has(f)) bad.push(a.activity + ": unknown need " + f);
  }
  assert.deepEqual(bad, []);
});
test("fallbacks point to activities that exist", () => {
  const tags = new Set(kb.map((a) => a.tag_id));
  for (const a of kb) for (const t of a.fallback_tags || []) assert.ok(tags.has(t), a.activity + " fallback " + t);
});
test("activities without a Qloo tag are not routed", () => {
  for (const a of all.filter((x) => !x.tag_id)) assert.ok(!kb.some((k) => k.activity === a.activity));
});
test("no false routes from everyday words that contain a keyword", () => {
  const probes = {
    "Spanish grammar for beginners": [], "Space exploration news": [], "Travel guide to Spain": [], "Spark dataframe tutorial": [],
    "Twine game engine docs": [], "Winery tour in Napa": [], "Swine flu history": [], "Hotelling model in economics": [],
    "Golfo de Mexico map": [], "Pooling resources in a team": [], "Spaghetti carbonara": [],
    "Skin care routine": [], "Stock market outlook": [], "Photo gallery layout css": [], "Audit trail logging": [], "Tackle this bug": [],
    "Build a PC DIY guide": [], "Install an ipa file": [], "Gig economy report": [], "Power outlet types": [], "Public holidays": [], "Skyline photography": [], "Tennessee history": [], "Hot potato salad": [], "Ramenskoye city history": [],
  };
  const wrong = [];
  for (const [t, expect] of Object.entries(probes)) { const got = hit(t); if (got.join() !== expect.join()) wrong.push(t + " -> " + got.join("|")); }
  assert.deepEqual(wrong, []);
});
test("true routes: English and Chinese each reach the intended activity and only it", () => {
  const cases = {
    "Badminton doubles tactics": "Badminton court", "羽球雙打戰術教學": "Badminton court", "羽毛球比赛": "Badminton court",
    "Pickleball rules explained": "Pickleball court", "匹克球入門": "Pickleball court",
    "Golf swing basics": "Golf course", "高爾夫揮桿": "Golf course", "Bowling league tips": "Bowling alley", "保齡球技巧": "Bowling alley",
    "Day spa near the city centre": "Spa", "水療體驗": "Spa", "Sports massage guide": "Massage", "按摩推薦": "Massage",
    "Best wine bars": "Wine bar", "威士忌品飲": "Wine bar", "Speakeasy cocktail menu": "Cocktail bar", "調酒入門": "Cocktail bar",
    "Autumn concert calendar": "Concert hall", "十月音樂會": "Concert hall", "Indoor swimming drills": "Swimming pool", "游泳訓練": "Swimming pool",
    "Pilates for desk workers": "Pilates studio", "皮拉提斯入門": "Pilates studio", "Art museums in Vienna": "Art museum", "美術館特展": "Art museum",
    "Yacht charter guide": "Yacht club", "遊艇行程": "Yacht club", "Omakase etiquette": "Fine dining restaurant", "台北無菜單日料": "Fine dining restaurant",
    "Vintage denim guide": "Vintage clothing store", "古著店推薦": "Vintage clothing store", "Streetwear drop this week": "Clothing store",
    "Craft beer taproom guide": "Brewery", "精釀啤酒入門": "Brewery", "Fly fishing for beginners": "Fishing store", "路亞釣魚教學": "Fishing store",
    "Easy weeknight recipes": "Cooking class", "家常菜食譜": "Cooking class", "Physiotherapy exercises for shoulders": "Physical therapist", "肩頸物理治療": "Physical therapist",
    "Best souvenirs from Taiwan": "Gift shop", "伴手禮推薦": "Gift shop", "Hiking trails near Taipei": "Hiking area", "Specialty coffee roasters": "Coffee shop",
    "Independent bookstore picks": "Book store", "Weight training for beginners": "Gym", "Tennis serve basics": "Tennis court", "Squash drills for beginners": "Squash court", "壁球入門": "Squash court", "Table tennis spin serve": "Table tennis", "桌球發球技巧": "Table tennis", "網球發球": "Tennis court", "Niseko ski guide": "Ski resort", "滑雪裝備": "Ski resort",
    "Boutique hotel in Hokkaido": "Hotel", "東京飯店推薦": "Hotel",
    "Ramen guide to Tokyo": "Ramen restaurant", "東京拉麵地圖": "Ramen restaurant", "台北火鍋推薦": "Hot pot restaurant", "Best hot pot in town": "Hot pot restaurant",
    "牛肉麵地圖": "Noodle shop", "Beef noodle shops worth the queue": "Noodle shop", "士林夜市攻略": "Night market", "Taiwan night market guide": "Night market",
  };
  const wrong = [];
  for (const [t, want] of Object.entries(cases)) { const got = hit(t); if (!got.includes(want) || got.length > 2) wrong.push(`${t} -> [${got}] wanted ${want}`); }
  assert.deepEqual(wrong, []);
});

test("cities: every city has an English key, a Chinese name and a measured coverage; the thin one is flagged", () => {
  const { cities } = load("../web/kb/cities.json");
  const seen = new Set();
  for (const c of cities) {
    assert.ok(c.en && c.zh && Number.isFinite(c.coverage), "incomplete city " + JSON.stringify(c));
    assert.ok(!seen.has(c.en), "duplicate city " + c.en); seen.add(c.en);
    assert.ok(/[一-鿿]/.test(c.zh), "zh name not Chinese for " + c.en);
  }
  assert.ok(cities.some((c) => c.en === "Taipei"), "default city present");
  assert.ok(cities.find((c) => c.en === "Hsinchu").coverage < 20, "Hsinchu is thin and must show the limited-data label");
});
test("tag ids are unique across activities and the two repaired routes use the working tags", () => {
  const ids = kb.map((a) => a.tag_id);
  assert.equal(new Set(ids).size, ids.length, "duplicate tag ids");
  assert.equal(kb.find((a) => a.activity === "Billiards").tag_id, "urn:tag:category:place:pool_hall");
  assert.equal(kb.find((a) => a.activity === "Massage").tag_id, "urn:tag:category:place:massage_therapist");
});

test("fallback-only activities never appear as ideas", () => {
  const r = rankActivities([{ title: "Sports massage guide", host: "x.com" }], kb, ["physical_repair", "mental_comfort"]);
  assert.ok(r.some((x) => x.activity === "Massage"));
  assert.ok(!r.some((x) => x.activity === "Massage spa"));
});

import { ACTIVITY_GLYPH, GLYPH } from "../web/js/icons.js";
test("icons: every queryable activity has a glyph that exists; no emoji left in data or icon file", () => {
  const miss = kb.filter((a) => !a.fallback_only && !GLYPH[ACTIVITY_GLYPH[a.activity]]).map((a) => a.activity);
  assert.deepEqual(miss, []);
  for (const g of Object.values(GLYPH)) assert.ok(/^<(path|circle|ellipse|rect|line|polyline|polygon)/.test(g) && !/<script|on\w+=|href=/i.test(g));
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.ok(!kb.some((a) => "icon" in a || emoji.test(JSON.stringify(a))), "emoji left in activities.json");
});
