// Taste-signal flow against a mock Qloo: names are resolved with one /search call each (place type only), only strict name matches
// become signals, the signal and explainability parameters reach /v2/insights, and each place comes back with a reason of its own
// (the saved place, Qloo's affinity, the tags the two share, the place's traits). When the signal leaves an idea with nothing
// (a cafe cannot rank concert halls), the ordinary list is shown for it and marked "untasted".
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
      // /search names the id "tag_id"; /v2/insights names it "id" (both seen on the real API)
      const savedTags = [{ tag_id: "urn:tag:ambience:qloo:modern", type: "urn:tag:ambience:qloo", name: "Modern" }, { tag_id: "urn:tag:beverage_offering:qloo:beer", type: "urn:tag:beverage_offering:qloo", name: "Beer" }, { tag_id: "urn:tag:category:place:coffee_shop", type: "urn:tag:category:place", name: "Coffee shop" }];
      return res.end(JSON.stringify({ results: q === "Simple Kaffa" ? [{ name: "Other Cafe", entity_id: "bad" }, { name: "Simple Kaffa Huashan Flagship Store", entity_id: PLACE, tags: savedTags }] : [{ name: "Totally Different Name", entity_id: "zzz" }] }));
    }
    const sig = u.searchParams.get("signal.interests.entities");
    if (u.searchParams.get("filter.type") === "urn:heatmap") { // the real API answers ~1,200 cells for a place signal and 0 for category tags
      const cells = sig ? Array.from({ length: 120 }, (_, i) => ({ location: { latitude: 25.0 + i / 1000, longitude: 121.5 + (i % 7) / 100, geohash: "wsq" + i }, query: { affinity: 1 - i / 200, affinity_rank: i + 1, popularity: 0.5 } })) : [];
      return res.end(JSON.stringify({ success: true, results: { heatmap: cells } }));
    }
    const rankedTags = [{ id: "urn:tag:accessibility:place:wheelchair_accessible_entrance", type: "urn:tag:accessibility:place", name: "Wheelchair accessible entrance" }, { id: "urn:tag:decor:qloo:rustic_chic", type: "urn:tag:decor:qloo", name: "Rustic chic" }, { id: "urn:tag:ambience:qloo:modern", type: "urn:tag:ambience:qloo", name: "Modern" }, { id: "urn:tag:category:place:coffee_shop", type: "urn:tag:category:place", name: "Coffee shop" }, { id: "urn:tag:menu_highlight:qloo:pour_over", type: "urn:tag:menu_highlight:qloo", name: "Pour over" }, { id: "urn:tag:specialty_dish:place:toast", type: "urn:tag:specialty_dish:place", name: "Toast" }];
    const ents = sig && u.searchParams.get("filter.tags") === "urn:tag:category:place:concert_hall" ? [] // measured on the real API: a cafe signal leaves concert halls empty
      : sig
      ? [{ name: "Ranked By Taste", location: { lat: 25.05, lon: 121.53 }, external: { google_place: [{ place_id: "ChIJl2x52TmoQjQR-1T_Ft6XMz8" }] }, properties: { address: "220, Taiwan, New Taipei City, Banqiao District, Sanmin Rd, 99號 2樓", short_description: "Popular indoor bowling center in Banqiao" }, tags: rankedTags, query: { affinity: 0.9716996430566086, explainability: { "signal.interests.entities": [{ entity_id: PLACE, score: 1 }] } } }]
      : [{ name: "Plain Result", properties: { address: "b" }, tags: [{ id: "urn:tag:genre:place", type: "urn:tag:genre:place", name: "Place" }, { id: "urn:tag:ambience:qloo:cozy", type: "urn:tag:ambience:qloo", name: "Cozy" }], query: {} }];
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
  assert.equal(p0.affinity, 97, "Qloo's affinity for this place, as a percentage");
  assert.deepEqual(p0.shared, ["Modern"], "descriptive tags shared with the saved place (category and accessibility tags are not reasons)");
  assert.deepEqual(p0.traits, ["Modern", "Rustic chic", "Pour over"], "the place's own traits, feel first, at most three");
  assert.equal(j.groups[0].untasted, false);
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

test("an idea the taste signal cannot rank (0 results with it, places without it) shows the ordinary list and says so", async () => {
  seen.length = 0;
  const r = await fetch(`http://127.0.0.1:${PORT}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ city: "Taipei", tags: ["urn:tag:category:place:concert_hall", "urn:tag:category:place:coffee_shop"], taste: ["Simple Kaffa"] }) });
  const j = await r.json();
  const [hall, cafe] = j.groups;
  assert.equal(hall.untasted, true);
  assert.deepEqual(hall.places.map((p) => p.name), ["Plain Result"]);
  assert.deepEqual(hall.places[0].because, []);
  assert.equal(hall.places[0].affinity, null);
  assert.deepEqual(hall.places[0].traits, ["Cozy"], "without a saved place the reason is the place's own traits");
  assert.equal(cafe.untasted, false);
  assert.equal(cafe.places[0].name, "Ranked By Taste");
  const hallCalls = seen.filter((s) => s.path === "/v2/insights" && s.q["filter.tags"] === "urn:tag:category:place:concert_hall");
  assert.deepEqual(hallCalls.map((s) => "signal.interests.entities" in s.q), [true, false], "ranked first, then the ordinary list; nothing else");
});

test("taste heatmap: asked only with a saved place and heatmap:true, same city and ids, strongest 80 of the cells, cached the second time", async () => {
  seen.length = 0;
  const post = (b) => fetch(`http://127.0.0.1:${PORT}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
  const j = await post({ city: "Taichung", tags: ["urn:tag:category:place:coffee_shop"], taste: ["Simple Kaffa"], heatmap: true });
  const h = seen.filter((s) => s.q["filter.type"] === "urn:heatmap");
  assert.equal(h.length, 1);
  assert.equal(h[0].q["filter.location.query"], "Taichung");
  assert.equal(h[0].q["signal.interests.entities"], PLACE);
  assert.ok(!("filter.tags" in h[0].q) && !("signal.interests.tags" in h[0].q), "the heatmap carries the city and the saved place only");
  assert.equal(j.heat.total, 120);
  assert.equal(j.heat.cells.length, 80);
  assert.ok(j.heat.cells.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.affinity >= 0));
  assert.ok(j.heat.cells.every((c, i, a) => i === 0 || a[i - 1].affinity >= c.affinity), "strongest first");
  assert.deepEqual(j.groups[0].places[0].loc, { lat: 25.05, lon: 121.53 }, "places carry their position so the page can mark them on the heatmap");
  const tr = j.trace.find((t) => t.params["filter.type"] === "urn:heatmap");
  assert.ok(tr && tr.count === 120 && tr.cached === false, "the heatmap request is in the evidence trace with its cell count");
  seen.length = 0;
  const again = await post({ city: "Taichung", tags: ["urn:tag:category:place:coffee_shop"], taste: ["Simple Kaffa"], heatmap: true });
  assert.equal(seen.filter((s) => s.q["filter.type"] === "urn:heatmap").length, 0, "answered from the 24-hour cache");
  assert.equal(again.trace.find((t) => t.params["filter.type"] === "urn:heatmap").cached, true);
  seen.length = 0;
  const none = await post({ city: "Taichung", tags: ["urn:tag:category:place:coffee_shop"], heatmap: true });
  assert.equal(seen.filter((s) => s.q["filter.type"] === "urn:heatmap").length, 0, "no saved place: category tags give no heatmap, so it is not asked");
  assert.equal(none.heat, null);
  seen.length = 0;
  const off = await post({ city: "Taichung", tags: ["urn:tag:category:place:coffee_shop"], taste: ["Simple Kaffa"] });
  assert.equal(seen.filter((s) => s.q["filter.type"] === "urn:heatmap").length, 0, "not asked unless the payload says heatmap:true");
  assert.equal(off.heat, null);
  const bad = await fetch(`http://127.0.0.1:${PORT}/api/recommend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ city: "Taichung", tags: ["urn:tag:category:place:coffee_shop"], heatmap: "yes" }) });
  assert.equal(bad.status, 400);
});
