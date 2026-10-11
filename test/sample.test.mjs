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
      "Online banking login": "removed:personal_or_account", "Current rates": "removed:personal_or_account", "My health records portal": "removed:personal_or_account",
  "Router admin": "removed:private_host", "Settings": "removed:non_web_scheme", "Shared doc": "removed:sensitive_query",
  "Shuttlecock feather grades explained": "ai", "Birdie, bogey and the fairway: a first-timer's guide": "ai",
  "Strike, spare, split: reading lane oil patterns": "ai", "Reformer classes: what to expect on day one": "ai",
};
const parse = (f) => [...readFileSync(new URL("../web/" + f, import.meta.url), "utf8").matchAll(/<A (?:ADD_DATE="\d+" )?HREF="([^"]+)">([^<]+)<\/A>/g)].map((m) => ({ url: m[1], title: m[2], folders: [] }));
const EXPECT_ZH = {
  "羽球雙打戰術教學": "kw:Badminton court", "匹克球規則解說": "kw:Pickleball court", "保齡球聯賽提高分數的技巧": "kw:Bowling alley", "室內游泳技巧練習": "kw:Swimming pool",
  "網球發球基本功": "kw:Tennis court", "給新手的高爾夫揮桿基礎": "kw:Golf course", "鼎泰豐信義店": "kw:Noodle shop", "台北葡萄酒推薦": "kw:Wine bar",
  "無菜單料理用餐禮儀": "kw:Fine dining restaurant", "東京拉麵指南": "kw:Ramen restaurant", "京都三日行程": "none", "維也納美術館參觀指南": "kw:Art museum",
  "北海道精品飯店": "kw:Hotel", "二世谷滑雪季指南": "kw:Ski resort", "電台司令 OK Computer 完整專輯": "none", "今年秋天的音樂會行事曆": "kw:Concert hall",
  "交響樂團樂季節目": "ai", "上班族的皮拉提斯": "kw:Pilates studio", "運動按摩與深層按摩的差別": "kw:Massage", "市區水療館": "kw:Spa",
  "聯準會利率決議對市場的意義": "none", "非同步程式設計教學": "none", "每週股市電子報": "none", "轉換器模型運作原理": "none",
  "網路銀行登入": "removed:personal_or_account", "目前利率": "removed:personal_or_account", "我的病歷入口網站": "removed:personal_or_account",
  "路由器管理": "removed:private_host", "設定": "removed:non_web_scheme", "分享的文件": "removed:sensitive_query",
  "鵝毛球與鴨毛球的差別": "ai", "小鳥球、柏忌與球道：新手入門": "ai", "全倒、補中、單瓶：看懂球道油紋": "ai", "核心床課程：第一堂課會發生什麼": "ai",
};
const SAMPLES = [["sample_bookmarks.html", EXPECT], ["sample_bookmarks.zh.html", EXPECT_ZH]];
const kb = JSON.parse(readFileSync(new URL("../web/kb/activities.json", import.meta.url))).filter((a) => a.tag_id && !a.fallback_only);

for (const [file, table] of SAMPLES) {
  const rows = parse(file);
  test(`${file}: the sample and the expectation table list exactly the same bookmarks`, () => {
    assert.deepEqual(rows.map((r) => r.title).sort(), Object.keys(table).sort());
  });
  test(`${file}: every bookmark is classified as expected`, () => {
    const wrong = [];
    for (const it of rows) {
      const r = classify({ ...it });
      const host = new URL(it.url.startsWith("chrome:") ? "https://x.invalid" : it.url).hostname.replace(/^www\./, "");
      const got = r ? "removed:" + r : (() => { const h = rankActivities([{ ...it, host }], kb, []).map((x) => x.activity); return h.length ? "kw:" + h.join("+") : null; })();
      const want = table[it.title];
      const ok = want === "ai" || want === "none" ? got === null : got === want;
      if (!ok) wrong.push(`${it.title}: got ${got}, wanted ${want}`);
    }
    assert.deepEqual(wrong, []);
  });
}
test("each sample is one language: English titles have no Chinese, Chinese titles have no English sentence", () => {
  for (const it of parse("sample_bookmarks.html")) assert.ok(!/[一-鿿]/.test(it.title), it.title);
  for (const it of parse("sample_bookmarks.zh.html")) assert.ok(!/[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(it.title), it.title);
});
