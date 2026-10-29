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
// Behind a proxy (Coolify/Traefik, Cloudflare) every request arrives from the proxy's address, so the per-IP limit needs the visitor's address from the
// proxy's header. Only when TRUST_PROXY=1 (set in the Dockerfile): on a direct connection those headers can be forged.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const clientIp = (req) => {
  if (TRUST_PROXY) {
    const cf = req.headers["cf-connecting-ip"], xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const ip = (typeof cf === "string" && cf.trim()) || xff;
    if (/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return ip;
  }
  return req.socket.remoteAddress;
};
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
  // The saved place's own descriptive tags (ambience, decor, drinks ...) are kept so each result can say what it shares with it.
  const v = hit ? { id: hit.entity_id, matched: hit.name, tags: describing(hit.tags) } : null;
  cache.set(k, { t: Date.now(), v });
  return v;
}

// Quality-first: Qloo ranks by refined, minimalist, artisan ambience tags (a taste signal) and places rated below 4.3 are left out.
// Measured on 5 city/category cells: mean rating rose in all 5 and big chains and tourist landmarks dropped out of the top 10.
const QUALITY_TAGS = "urn:tag:ambience:qloo:refined,urn:tag:ambience:qloo:minimalist,urn:tag:ambience:qloo:artisan";
const QUALITY_MIN_RATING = "4.3";

// Tags that describe a place (Qloo's own ambience, decor, drinks, setting ... and the place's dishes and price band), as opposed to
// listing tags (category, accessibility, parking, payments). Both /search and /v2/insights return them; /search names the id "tag_id".
const DESCRIBING = /^urn:tag:(?:[a-z_]+:qloo|specialty_dish:place|cost_description:place):/;
const describing = (tags) => (tags || []).map((t) => ({ id: t.id || t.tag_id || "", name: String(t.name || "") })).filter((t) => DESCRIBING.test(t.id) && t.name);
// The order in which a place's traits are shown: the three quality-first ambience tags first (when that mode is on), then feel, then food and drink.
const TRAIT_ORDER = ["ambience", "decor", "setting", "noise_level", "interests", "menu_highlight", "beverage_offering", "specialty_dish", "culinary_style", "cost_description"];
const traitRank = (id) => { const k = TRAIT_ORDER.findIndex((t) => id.startsWith("urn:tag:" + t + ":")); return k < 0 ? TRAIT_ORDER.length : k; };
const QUALITY_SET = new Set(QUALITY_TAGS.split(","));
// Why this place: which saved place it was ranked by and Qloo's affinity for it, the descriptive tags it shares with that saved place,
// and (always) up to three of its own traits, so two places under the same idea never carry the same line.
function why(e, taste, quality) {
  const own = describing(e.tags);
  const because = (e.query?.explainability?.["signal.interests.entities"] || []).map((x) => taste.find((t) => t.id === x.entity_id)).filter(Boolean);
  const theirs = new Set(because.flatMap((t) => t.tags || []).map((t) => t.id));
  const shared = [...new Map(own.filter((t) => theirs.has(t.id)).sort((a, b) => traitRank(a.id) - traitRank(b.id)).map((t) => [t.name, t])).values()].slice(0, 3).map((t) => t.name);
  const ranked = own.sort((a, b) => (quality ? Number(QUALITY_SET.has(b.id)) - Number(QUALITY_SET.has(a.id)) : 0) || traitRank(a.id) - traitRank(b.id));
  const traits = [...new Set(ranked.map((t) => t.name))].slice(0, 3);
  const affinity = typeof e.query?.affinity === "number" ? Math.round(e.query.affinity * 100) : null;
  return { because: because.map((t) => t.name), affinity, shared, traits };
}

// taste: [{id, name, tags}] (already resolved). Results are ranked by Qloo with those places as taste signals.
async function qloo(tag, city, taste = [], quality = false, trace = null) {
  const ids = taste.map((t) => t.id).sort();
  const k = tag + "|" + city + "|" + ids.join(",") + (quality ? "|q" : ""), c = cache.get(k);
  const q = { "filter.type": "urn:entity:place", "filter.location.query": city, "filter.tags": tag, take: "5" };
  if (ids.length) { q["signal.interests.entities"] = ids.join(","); q["feature.explainability"] = "true"; }
  if (quality) { q["signal.interests.tags"] = QUALITY_TAGS; q["filter.rating.min"] = QUALITY_MIN_RATING; }
  const u = new URL(BASE + "/v2/insights"); u.search = new URLSearchParams(q);
  if (c && Date.now() - c.t < TTL_MS) { if (trace) trace.push(traceEntry(u, { status: 200, ms: 0, cached: true, count: c.v.length })); return c.v; }
  const j = await call(u, trace);
  const v = (j.results?.entities || []).slice(0, 5).map((e) => ({
    name: e.name, address: e.properties?.address || "",
    about: String(e.properties?.short_description || "").slice(0, 140),
    area: String(e.properties?.address || "").replace(/[一-鿿].*$/, "").replace(/[,\s]+$/, "").slice(0, 90), // the English part of the address
    place_id: /^[A-Za-z0-9_-]{10,200}$/.test(e.external?.google_place?.[0]?.place_id || "") ? e.external.google_place[0].place_id : "",
    loc: Number.isFinite(e.location?.lat) && Number.isFinite(e.location?.lon) ? { lat: e.location.lat, lon: e.location.lon } : null,
    ...why(e, taste, quality),
  }));
  cache.set(k, { t: Date.now(), v });
  return v;
}

// Taste heatmap: where places with the taste of the saved places cluster in the city (filter.type=urn:heatmap with the same
// signal.interests.entities). Qloo answers with about a thousand geohash cells and an affinity for each; the strongest cells are kept
// for the page. The city and the saved places are the only inputs, the same ones the visitor already approved. Category tags alone
// give no heatmap (0 cells for Taipei and London, measured 2026-10-29), so this is asked only when a saved place is ticked.
const HEAT_CELLS = 80;
async function heatmap(city, taste, trace) {
  const ids = taste.map((t) => t.id).sort();
  const k = "h|" + city + "|" + ids.join(","), c = cache.get(k);
  const u = new URL(BASE + "/v2/insights");
  u.search = new URLSearchParams({ "filter.type": "urn:heatmap", "filter.location.query": city, "signal.interests.entities": ids.join(",") });
  if (c && Date.now() - c.t < TTL_MS) { if (trace) trace.push(traceEntry(u, { status: 200, ms: 0, cached: true, count: c.v.total })); return c.v; }
  const j = await call(u, trace);
  const all = (j.results?.heatmap || []).filter((h) => Number.isFinite(h.location?.latitude) && Number.isFinite(h.location?.longitude));
  if (trace) trace[trace.length - 1].count = all.length;
  const cells = all.map((h) => ({ lat: h.location.latitude, lon: h.location.longitude, affinity: Number(h.query?.affinity) || 0 }))
    .sort((a, b) => b.affinity - a.affinity).slice(0, HEAT_CELLS);
  // Qloo names the city it resolved (query.localities.filter[0].location); the page marks it so the cells can be read against a known point.
  const cl = j.query?.localities?.filter?.[0]?.location;
  const center = Number.isFinite(cl?.lat) && Number.isFinite(cl?.lon) ? { lat: cl.lat, lon: cl.lon } : null;
  const v = { total: all.length, cells, center };
  cache.set(k, { t: Date.now(), v });
  return v;
}

// Browser-side security headers. The page loads its on-device model code from cdn.jsdelivr.net, the model files from Hugging Face,
// runs WebAssembly, and shows a Google Maps frame; nothing else is allowed. The one inline script (the start-up safety net in
// index.html) is allowed by its hash; test/server.test.mjs fails if that script changes without the hash. Inline styles exist in index.html, so style-src allows them.
const SEC = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'sha256-5N+dKx/zTemdokkZo0S3lzxqpcpcrtKbyndrqaH4ufo=' https://cdn.jsdelivr.net 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; " +
    "connect-src 'self' https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co blob: data:; " +
    "frame-src https://www.google.com https://maps.google.com; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
const server = http.createServer(async (req, res) => {
  const send = (code, obj, type = "application/json") => { res.writeHead(code, { "content-type": type, ...SEC }); res.end(typeof obj === "string" ? obj : JSON.stringify(obj)); };
  try {
    if (req.method === "POST" && req.url === "/api/recommend") {
      const ip = clientIp(req), now = Date.now();
      const arr = (hits.get(ip) || []).filter((t) => now - t < 60000); arr.push(now); hits.set(ip, arr);
      if (arr.length > PER_IP_PER_MIN) return send(429, { error: "slow_down" });
      let body = ""; for await (const ch of req) { body += ch; if (body.length > 4000) return send(413, { error: "too_large" }); }
      const { city, tags, taste = [], quality = false, heatmap: wantHeat = false } = JSON.parse(body || "{}");
      if (typeof quality !== "boolean" || typeof wantHeat !== "boolean" || !CITIES.has(city) || !Array.isArray(tags) || tags.length > 12 || !tags.every((t) => typeof t === "string" && TAG_RE.test(t)) ||
          !Array.isArray(taste) || taste.length > 5 || !taste.every((n) => typeof n === "string" && n.trim().length >= 2 && n.length <= 60 && !/[\u0000-\u001f]/.test(n)))
        return send(400, { error: "bad_request" });
      const trace = [], known = [], unknown = [];
      for (const n of [...new Set(taste.map((x) => x.trim()))]) {
        try { const r = await resolve(n, trace); if (r) known.push({ id: r.id, name: n, matched: r.matched, tags: r.tags || [] }); else unknown.push(n); }
        catch (e) { if (["not_configured", "budget"].includes(e.message)) return send(503, { error: e.message }); unknown.push(n); }
      }
      const groups = [];
      for (const t of tags) {
        try {
          let places = await qloo(t, city, known, quality, trace), via = null, plain = null, relaxed = false, untasted = false;
          if (quality && !places.length) { places = await qloo(t, city, known, false, trace); relaxed = true; } // nothing met the bar: show the ordinary list and say so
          if (known.length || (quality && !relaxed)) {
            const ordinary = await qloo(t, city, [], false, trace); plain = ordinary.map((p) => p.name);
            // A saved cafe gives Qloo nothing to rank concert halls or golf courses by (0 results with the signal, 5 without, measured in
            // Taipei), so the ordinary list is shown for that idea and the page says so, instead of "no places found".
            if (!places.length && known.length && ordinary.length) { places = ordinary; untasted = true; }
          }
          if (!places.length && fallbackOf[t]) {
            const seen = new Set(), merged = [];
            for (const ft of fallbackOf[t].tags) for (const p of await qloo(ft, city, known, quality, trace)) if (!seen.has(p.name)) { seen.add(p.name); merged.push(p); }
            places = merged.slice(0, 5);
            via = fallbackOf[t].tags.map((x) => nameOf[x] || x).join(" and ") + " (shared courts)";
          }
          groups.push({ activity: nameOf[t] || t, places, via, plain, relaxed, untasted });
        }
        catch (e) { if (["not_configured", "budget"].includes(e.message)) return send(503, { error: e.message }); groups.push({ activity: nameOf[t] || t, places: [] }); }
      }
      let heat = null;
      if (wantHeat && known.length) {
        try { heat = await heatmap(city, known, trace); }
        catch (e) { if (["not_configured", "budget"].includes(e.message)) return send(503, { error: e.message }); heat = { total: 0, cells: [], failed: true }; }
      }
      return send(200, { groups, source: "Qloo", quality, trace, heat, taste: { used: known.map((k) => ({ name: k.name, matched: k.matched })), unknown } });
    }
    if (req.method === "GET" && req.url === "/api/health") return send(200, { ok: true, configured: !!KEY, used });
    const path = normalize(decodeURIComponent((req.url || "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, path === "/" || path === "\\" ? "index.html" : path);
    if (!file.startsWith(ROOT)) return send(403, "forbidden", "text/plain");
    const data = await readFile(file);
    const type = MIME[extname(file)] || "application/octet-stream";
    const fresh = /^(text\/|application\/(json|javascript|manifest))/.test(type); // page, code, data: always ask the server again
    res.writeHead(200, { "content-type": type.startsWith("image/png") ? type : type + "; charset=utf-8", "cache-control": fresh ? "no-cache" : "public, max-age=86400", ...SEC }); res.end(data);
  } catch (e) { send(e.code === "ENOENT" ? 404 : 500, { error: "error" }); }
});
// Behind a hosting proxy that reuses connections, keep idle connections open longer than the proxy does (Node's default is 5 s);
// otherwise the proxy can send a request on a connection Node has just closed, and that request hangs.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.listen(PORT, HOST, () => console.log(`serving web/ on http://${HOST}:${PORT}  (qloo configured: ${!!KEY})`));
