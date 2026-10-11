// Every bookmark in the demo sample has an expected result. A wrong route fails the test.
// "kw" = routed by keyword. "removed:<reason>" = removed by the privacy gate. "ai" = no keyword on purpose (on-device matching demo).
// "none" = should match nothing. Run: node --test test/sample.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify } from "../web/js/gate.js";
import { rankActivities } from "../web/js/combine.js";

const EXPECT = {
  "Badminton doubles tactics for beginners": "kw:Badminton court", "Pickleball rules explained": "kw:Pickleball court",
  "Bowling league tips for higher scores": "kw:Bowling alley", "Indoor swimming technique drills": "kw:Swimming pool",
  "Tennis serve basics": "kw:Tennis court", "Golf swing basics for newcomers": "kw:Golf course",
  "Din Tai Fung Xinyi Branch": "kw:Noodle shop", "Best wine bars in Taipei": "kw:Wine bar", "Omakase etiquette guide": "kw:Fine dining restaurant",
  "Ramen guide to Tokyo": "kw:Ramen restaurant", "Kyoto 3-day itinerary": "none", "Art museums to visit in Vienna": "kw:Art museum",
  "Boutique hotel in Hokkaido": "kw:Hotel", "Ski season guide to Niseko": "kw:Ski resort", "Radiohead - OK Computer (full album)": "none",
  "Concert calendar this autumn": "kw:Concert hall", "Symphony orchestra season programme": "ai", "Pilates for desk workers": "kw:Pilates studio",
  "Sports massage vs deep tissue massage": "kw:Massage", "Day spa near the city centre": "kw:Spa",
  "Fed rate decision: what it means for markets": "none", "Python asyncio tutorial": "none", "Weekly stock market newsletter": "none", "How transformers work": "none",
  "羽球雙打戰術教學": "kw:Badminton court", "皮拉提斯入門課程": "kw:Pilates studio", "台北無菜單日料推薦": "kw:Fine dining restaurant",
  "十月音樂會節目表": "kw:Concert hall", "台北火鍋推薦": "kw:Hot pot restaurant", "牛肉麵地圖": "kw:Noodle shop", "士林夜市攻略": "kw:Night market",
  "Online banking login": "removed:personal_or_account", "Current rates": "removed:personal_or_account", "My health records portal": "removed:personal_or_account",
  "Router admin": "removed:private_host", "Settings": "removed:non_web_scheme", "Shared doc": "removed:sensitive_query",
  "Shuttlecock feather grades explained": "ai", "Birdie, bogey and the fairway: a first-timer's guide": "ai",
  "Strike, spare, split: reading lane oil patterns": "ai", "Reformer classes: what to expect on day one": "ai",
};
const html = readFileSync(new URL("../web/sample_bookmarks.html", import.meta.url), "utf8");
const rows = [...html.matchAll(/<A (?:ADD_DATE="\d+" )?HREF="([^"]+)">([^<]+)<\/A>/g)].map((m) => ({ url: m[1], title: m[2], folders: [] }));
const kb = JSON.parse(readFileSync(new URL("../web/kb/activities.json", import.meta.url))).filter((a) => a.tag_id && !a.fallback_only);

test("the sample and the expectation table list exactly the same bookmarks", () => {
  assert.deepEqual(rows.map((r) => r.title).sort(), Object.keys(EXPECT).sort());
});
test("every sample bookmark is classified as expected", () => {
  const wrong = [];
  for (const it of rows) {
    const r = classify({ ...it });
    const host = new URL(it.url.startsWith("chrome:") ? "https://x.invalid" : it.url).hostname.replace(/^www\./, "");
    const got = r ? "removed:" + r : (() => { const h = rankActivities([{ ...it, host }], kb, []).map((x) => x.activity); return h.length ? "kw:" + h.join("+") : null; })();
    const want = EXPECT[it.title];
    const ok = want === "ai" || want === "none" ? got === null : got === want;
    if (!ok) wrong.push(`${it.title}: got ${got}, wanted ${want}`);
  }
  assert.deepEqual(wrong, []);
});
