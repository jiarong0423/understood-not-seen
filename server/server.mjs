// Thin server: serves web/ and proxies Qloo place lookups. Run: node --env-file=.env server/server.mjs
// The browser sends only {city, tags:[Qloo tag ids]}. The API key never leaves this process.
// Qloo responses are kept in MEMORY only (private cache) and are never written to disk or the repository.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "web");
const PORT = Number(process.env.PORT || 8770);
const HOST = process.env.HOST || "127.0.0.1";
const KEY = process.env.QLOO_API_KEY || "";
const BASE = process.env.QLOO_BASE || "https://hackathon.api.qloo.com"; // override only in tests
const CITIES = new Set(JSON.parse(await readFile(join(ROOT, "kb", "cities.json"), "utf8")).cities.map((c) => c.en));
const TAG_RE = /^urn:tag:[a-z_]+:place(?::[a-z0-9_]+){1,2}$/;
const MONTHLY_BUDGET = Number(process.env.QLOO_MONTHLY_BUDGET || 8000); // keep headroom under the 10,000 limit
const GAP_MS = 250, TTL_MS = 24 * 3600 * 1000, PER_IP_PER_MIN = 20;
const kb = JSON.parse(await readFile(join(ROOT, "kb", "activities.json"), "utf8"));
const nameOf = Object.fromEntries(kb.filter((a) => a.tag_id).map((a) => [a.tag_id, a.activity]));
const fallbackOf = Object.fromEntries(kb.filter((a) => a.fallback_tags).map((a) => [a.tag_id, { tags: a.fallback_tags, note: a.fallback_note }]));
const cache = new Map(), hits = new Map();
let used = 0, last = 0;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every Qloo request is recorded for the visitor ("Evidence" panel): endpoint, parameters, status, time, result count, cache state. The key is never part of it.
const traceEntry = (u, extra) => ({ endpoint: u.pathname, params: Object.fromEntries(u.searchParams), ...extra });
async function call(u, trace) {
  if (!KEY) throw new Error("not_configured");
  if (used >= MONTHLY_BUDGET) throw new Error("budget");
  const wait = last + GAP_MS - Date.now(); if (wait > 0) await sleep(wait);
  last = Date.now(); used++;
  const t0 = Date.now();
  let r = await fetch(u, { headers: { "X-Api-Key": KEY } });
  if (r.status === 429) { await sleep(1200); last = Date.now(); r = await fetch(u, { headers: { "X-Api-Key": KEY } }); }
  if (trace) trace.push(traceEntry(u, { status: r.status, ms: Date.now() - t0, cached: false }));
  if (!r.ok) throw new Error("upstream_" + r.status);
  const j = await r.json();
  if (trace) { const e = trace[trace.length - 1]; e.count = (j.results?.entities || j.results || []).length; }
  return j;
}

// Taste signals: a saved place name -> a Qloo place entity id. One /search call per name (one entity type per call).
const norm = (x) => x.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
async function resolve(name, trace) {
  const k = "r|" + norm(name), c = cache.get(k);
  const u = new URL(BASE + "/search");
  u.search = new URLSearchParams({ query: name, types: "urn:entity:place", take: "5" });
  if (c && Date.now() - c.t < TTL_MS) { if (trace) trace.push(traceEntry(u, { status: 200, ms: 0, cached: true, count: c.v ? 1 : 0 })); return c.v; }
  const j = await call(u, trace);
  const want = norm(name);
  const hit = (j.results || []).find((e) => {
    const got = norm(e.name || ""); const short = Math.min(got.length, want.length);
    return short >= 3 && (got === want || got.startsWith(want) || want.startsWith(got));
  });
  const v = hit ? { id: hit.entity_id, matched: hit.name } : null;
  cache.set(k, { t: Date.now(), v });
  return v;
}

// Quality-first: Qloo ranks by refined, minimalist, artisan ambience tags (a taste signal) and places rated below 4.3 are left out.
// Measured on 5 city/category cells: mean rating rose in all 5 and big chains and tourist landmarks dropped out of the top 10.
const QUALITY_TAGS = "urn:tag:ambience:qloo:refined,urn:tag:ambience:qloo:minimalist,urn:tag:ambience:qloo:artisan";
const QUALITY_MIN_RATING = "4.3";

// taste: [{id, name}] (already resolved). Results are ranked by Qloo with those places as taste signals.
async function qloo(tag, city, taste = [], quality = false, trace = null) {
  const ids = taste.map((t) => t.id).sort();
  const k = tag + "|" + city + "|" + ids.join(",") + (quality ? "|q" : ""), c = cache.get(k);
  const q = { "filter.type": "urn:entity:place", "filter.location.query": city, "filter.tags": tag, take: "5" };
  if (ids.length) { q["signal.interests.entities"] = ids.join(","); q["feature.explainability"] = "true"; }
  if (quality) { q["signal.interests.tags"] = QUALITY_TAGS; q["filter.rating.min"] = QUALITY_MIN_RATING; }
  const u = new URL(BASE + "/v2/insights"); u.search = new URLSearchParams(q);
  if (c && Date.now() - c.t < TTL_MS) { if (trace) trace.push(traceEntry(u, { status: 200, ms: 0, cached: true, count: c.v.length })); return c.v; }
  const j = await call(u, trace);
  const nameById = Object.fromEntries(taste.map((t) => [t.id, t.name]));
  const v = (j.results?.entities || []).slice(0, 5).map((e) => ({
    name: e.name, address: e.properties?.address || "",
    because: (e.query?.explainability?.["signal.interests.entities"] || []).map((x) => nameById[x.entity_id]).filter(Boolean),
  }));
  cache.set(k, { t: Date.now(), v });
  return v;
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(typeof obj === "string" ? obj : JSON.stringify(obj)); };
  try {
    if (req.method === "POST" && req.url === "/api/recommend") {
      const ip = req.socket.remoteAddress, now = Date.now();
      const arr = (hits.get(ip) || []).filter((t) => now - t < 60000); arr.push(now); hits.set(ip, arr);
      if (arr.length > PER_IP_PER_MIN) return send(429, { error: "slow_down" });
      let body = ""; for await (const ch of req) { body += ch; if (body.length > 4000) return send(413, { error: "too_large" }); }
      const { city, tags, taste = [], quality = false } = JSON.parse(body || "{}");
      if (typeof quality !== "boolean" || !CITIES.has(city) || !Array.isArray(tags) || tags.length > 12 || !tags.every((t) => typeof t === "string" && TAG_RE.test(t)) ||
          !Array.isArray(taste) || taste.length > 5 || !taste.every((n) => typeof n === "string" && n.trim().length >= 2 && n.length <= 60 && !/[\u0000-\u001f]/.test(n)))
        return send(400, { error: "bad_request" });
      const trace = [], known = [], unknown = [];
      for (const n of [...new Set(taste.map((x) => x.trim()))]) {
        try { const r = await resolve(n, trace); if (r) known.push({ id: r.id, name: n, matched: r.matched }); else unknown.push(n); }
        catch (e) { if (["not_configured", "budget"].includes(e.message)) return send(503, { error: e.message }); unknown.push(n); }
      }
      const groups = [];
      for (const t of tags) {
        try {
          let places = await qloo(t, city, known, quality, trace), via = null, plain = null, relaxed = false;
          if (quality && !places.length) { places = await qloo(t, city, known, false, trace); relaxed = true; } // nothing met the bar: show the ordinary list and say so
          if (known.length || (quality && !relaxed)) plain = (await qloo(t, city, [], false, trace)).map((p) => p.name);
          if (!places.length && fallbackOf[t]) {
            const seen = new Set(), merged = [];
            for (const ft of fallbackOf[t].tags) for (const p of await qloo(ft, city, known, quality, trace)) if (!seen.has(p.name)) { seen.add(p.name); merged.push(p); }
            places = merged.slice(0, 5);
            via = fallbackOf[t].tags.map((x) => nameOf[x] || x).join(" and ") + " (shared courts)";
          }
          groups.push({ activity: nameOf[t] || t, places, via, plain, relaxed });
        }
        catch (e) { if (["not_configured", "budget"].includes(e.message)) return send(503, { error: e.message }); groups.push({ activity: nameOf[t] || t, places: [] }); }
      }
      return send(200, { groups, source: "Qloo", quality, trace, taste: { used: known.map((k) => ({ name: k.name, matched: k.matched })), unknown } });
    }
    if (req.method === "GET" && req.url === "/api/health") return send(200, { ok: true, configured: !!KEY, used });
    const path = normalize(decodeURIComponent((req.url || "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, path === "/" || path === "\\" ? "index.html" : path);
    if (!file.startsWith(ROOT)) return send(403, "forbidden", "text/plain");
    const data = await readFile(file);
    const type = MIME[extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type.startsWith("image/png") ? type : type + "; charset=utf-8" }); res.end(data);
  } catch (e) { send(e.code === "ENOENT" ? 404 : 500, { error: "error" }); }
});
server.listen(PORT, HOST, () => console.log(`serving web/ on http://${HOST}:${PORT}  (qloo configured: ${!!KEY})`));
