// Place names, one language at a time: the pasted Taipei results must come out clean in both languages.
// Run: node --test test/names.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placeName, splitName, hasForm } from "../web/js/names.js";

const table = JSON.parse(readFileSync(new URL("../web/kb/place_names.json", import.meta.url))).names;
const CJK = /[一-鿿]/;

test("mixed names are split: Latin part for English, Chinese part for Chinese", () => {
  assert.equal(placeName("Mars Fitness 瑪爾斯全方位運動空間", "en", table), "Mars Fitness");
  assert.equal(placeName("Mars Fitness 瑪爾斯全方位運動空間", "zh", table), "瑪爾斯全方位運動空間");
  assert.equal(placeName("樂埔町 Leputing", "en", table), "Leputing");
  assert.equal(placeName("樂埔町 Leputing", "zh", table), "樂埔町");
});
test("a Chinese hint in brackets after a Latin name is dropped, not shown as a name", () => {
  assert.equal(placeName("Impromptu by Paul Lee (麗晶精品林森北路出入口下來）", "en", table), "Impromptu by Paul Lee");
  assert.deepEqual(splitName("Impromptu by Paul Lee (麗晶精品林森北路出入口下來）"), { en: "Impromptu by Paul Lee", zh: null });
});
test("the mapping table gives the other language for the listed places", () => {
  assert.equal(placeName("Taipei Wenshan Sports Center", "zh", table), "臺北市文山運動中心");
  assert.equal(placeName("Taipei Wenshan Sports Center", "en", table), "Taipei Wenshan Sports Center");
  assert.equal(placeName("高手庭園保齡球館", "en", table), "Gaoshou Garden Bowling Alley");
  assert.equal(placeName("高手庭園保齡球館", "zh", table), "高手庭園保齡球館");
});
test("English page: no Chinese in any pasted Taipei name; Chinese page: Chinese wherever the table or the split can give it", () => {
  const taipei = ["Taipei City Jhong Jheng Sports Center", "Taipei Zhongshan Hall", "National Concert Hall", "文水藝文中心", "Taipei National University of the Arts",
    "Impromptu by Paul Lee (麗晶精品林森北路出入口下來）", "樂埔町 Leputing", "Fuhong Beef Noodles", "Ay-Chung Flour-Rice Noodle", "Mars Fitness 瑪爾斯全方位運動空間",
    "National Palace Museum", "Taipei Fine Arts Museum", "E7PLAY", "高手庭園保齡球館", "星聚點KTV台北旗艦館+星聚點AI撞球館+星聚點保齡球館",
    "Kuo Hua Golf & Country Club", "石牌高爾夫練習場", "揮皇高爾夫球場", "喬大高爾夫學苑"];
  assert.deepEqual(taipei.filter((n) => CJK.test(placeName(n, "en", table))), []);
  const stillLatin = taipei.filter((n) => !hasForm(n, "zh", table));
  assert.deepEqual(stillLatin, ["Impromptu by Paul Lee (麗晶精品林森北路出入口下來）", "E7PLAY"], "only names we have no Chinese form for stay Latin");
});
test("table entries: zh values are Chinese, en values have no Chinese and are marked when translated", () => {
  for (const [k, v] of Object.entries(table)) {
    if (v.zh) assert.ok(CJK.test(v.zh), k);
    if (v.en) { assert.ok(!CJK.test(v.en), k); assert.equal(v.translated, true, k + " en must be marked translated"); }
  }
});
