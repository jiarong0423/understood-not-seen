// Taste-signal flow against a mock Qloo: names are resolved with one /search call each (place type only), only strict name matches
// become signals, the signal and explainability parameters reach /v2/insights, and "because" names come back.
// No real quota is used. Run: node --test test/taste.test.mjs
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = [];
let mock, child, PORT, MOCK;
const PLACE = "11111111-1111-1111-1111-111111111111";

before(async () => {
  MOCK = await freePort(); PORT = await freePort();
  mock = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"); seen.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), key: req.headers["x-api-key"] });
    res.setHeader("content-type", "application/json");
    if (u.pathname === "/search") {
      const q = u.searchParams.get("query");
      return res.end(JSON.stringify({ results: q === "Simple Kaffa" ? [{ name: "Other Cafe", entity_id: "bad" }, { name: "Simple Kaffa Huashan Flagship Store", entity_id: PLACE }] : [{ name: "Totally Different Name", entity_id: "zzz" }] }));
    }
    const sig = u.searchParams.get("signal.interests.entities");
    const ents = sig
      ? [{ name: "Ranked By Taste", external: { google_place: [{ place_id: "ChIJl2x52TmoQjQR-1T_Ft6XMz8" }] }, properties: { address: "220, Taiwan, New Taipei City, Banqiao District, Sanmin Rd, 99號 2樓", short_description: "Popular indoor bowling center in Banqiao" }, query: { explainability: { "signal.interests.entities": [{ entity_id: PLACE, score: 1 }] } } }]
      : [{ name: "Plain Result", properties: { address: "b" }, query: {} }];
    res.end(JSON.stringify({ results: { entities: ents } }));
  });
  await new Promise((r) => mock.listen(MOCK, "127.0.0.1", r));
  child = spawn("node", ["server/server.mjs"], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", QLOO_API_KEY: "fake-key-for-tests", QLOO_BASE: `http://127.0.0.1:${MOCK}` }, stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch { await wait(100); } }
});
after(async () => { child.kill("SIGTERM"); await new Promise((r) => mock.close(r)); });

test("a saved place becomes a taste signal, explained by its name; unknown names are reported, not guessed", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ city: "Taipei", tags: ["urn:tag:category:place:coffee_shop"], taste: ["Simple Kaffa", "Nonexistent Place"] }) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.taste.used.map((x) => x.name), ["Simple Kaffa"]);
  assert.deepEqual(j.taste.unknown, ["Nonexistent Place"]);
  assert.equal(j.groups[0].places[0].name, "Ranked By Taste");
  assert.deepEqual(j.groups[0].places[0].because, ["Simple Kaffa"]);
  const p0 = j.groups[0].places[0];
  assert.equal(p0.about, "Popular indoor bowling center in Banqiao");
  assert.equal(p0.area, "220, Taiwan, New Taipei City, Banqiao District, Sanmin Rd, 99");
  assert.equal(p0.place_id, "ChIJl2x52TmoQjQR-1T_Ft6XMz8");
  assert.deepEqual(j.groups[0].plain, ["Plain Result"]);
  const searches = seen.filter((s) => s.path === "/search");
  assert.equal(searches.length, 2);
  assert.ok(searches.every((s) => s.q.types === "urn:entity:place" && !s.q.types.includes(",")), "one entity type per search call");
  const ranked = seen.find((s) => s.path === "/v2/insights" && s.q["signal.interests.entities"]);
  assert.equal(ranked.q["signal.interests.entities"], PLACE);
  assert.equal(ranked.q["feature.explainability"], "true");
  assert.equal(ranked.key, "fake-key-for-tests");
});
test("without taste names no search call and no signal parameter is sent", async () => {
  seen.length = 0;
  const r = await fetch(`http://127.0.0.1:${PORT}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ city: "Tokyo", tags: ["urn:tag:category:place:gym"] }) });
  const j = await r.json();
  assert.equal(seen.filter((s) => s.path === "/search").length, 0);
  assert.ok(seen.every((s) => !("signal.interests.entities" in s.q)));
  assert.deepEqual(j.taste.used, []);
  assert.equal(j.groups[0].plain, null);
});

import { nameFromTitle } from "../web/js/taste.js";
test("name proposals: brand-like first segments yes; phrases, pages and URLs no", () => {
  const yes = { "Simple Kaffa | Specialty coffee roasters": "Simple Kaffa", "Fika Fika Cafe - Nordic coffee": "Fika Fika Cafe", "DOUSHOP 古著店": "DOUSHOP 古著店", "Louisa Coffee": "Louisa Coffee" };
  for (const [t, n] of Object.entries(yes)) assert.equal(nameFromTitle(t), n, t);
  for (const t of ["Craft beer taproom guide", "Pour over coffee at home guide", "Home", "https://x.com/a", "12345", "a", "Login | Site", "name@example.com", "羽球雙打戰術教學", "台北火鍋推薦", "士林夜市攻略"])
    assert.equal(nameFromTitle(t), null, t);
});

test("quality-first sends the ambience signal and the rating floor; without it neither is sent", async () => {
  seen.length = 0;
  const post = (b) => fetch(`http://127.0.0.1:${PORT}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
  const j = await post({ city: "Taipei", tags: ["urn:tag:category:place:bakery"], quality: true });
  const q = seen.find((x) => x.path === "/v2/insights" && x.q["filter.rating.min"]);
  assert.equal(q.q["filter.rating.min"], "4.3");
  assert.match(q.q["signal.interests.tags"], /ambience:qloo:refined/);
  assert.equal(j.quality, true);
  seen.length = 0;
  await post({ city: "Taipei", tags: ["urn:tag:category:place:bakery"] });
  assert.ok(seen.every((x) => !x.q["filter.rating.min"] && !x.q["signal.interests.tags"]));
  const bad = await fetch(`http://127.0.0.1:${PORT}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ city: "Taipei", tags: ["urn:tag:category:place:bakery"], quality: "yes" }) });
  assert.equal(bad.status, 400);
});

test("the evidence trace lists every Qloo request with its parameters and never contains the key", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ city: "London", tags: ["urn:tag:category:place:wine_bar"], quality: true, taste: ["Simple Kaffa"] }) });
  const j = await r.json();
  assert.ok(Array.isArray(j.trace) && j.trace.length >= 3, "search + ranked + plain list");
  const insights = j.trace.filter((t) => t.endpoint === "/v2/insights");
  assert.ok(insights.some((t) => t.params["filter.tags"] === "urn:tag:category:place:wine_bar" && t.params["filter.rating.min"] === "4.3"));
  assert.ok(j.trace.some((t) => t.endpoint === "/search" && t.params.types === "urn:entity:place"));
  for (const t of j.trace) assert.ok(Number.isInteger(t.status) && typeof t.cached === "boolean" && t.endpoint.startsWith("/"));
  assert.ok(!JSON.stringify(j).includes("fake-key-for-tests"), "key leaked into the response");
  const again = await (await fetch(`http://127.0.0.1:${PORT}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ city: "London", tags: ["urn:tag:category:place:wine_bar"], quality: true, taste: ["Simple Kaffa"] }) })).json();
  assert.ok(again.trace.length >= 3 && again.trace.every((t) => t.cached === true), "second identical request is answered from cache and says so");
});
