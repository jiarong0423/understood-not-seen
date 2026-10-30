// Server protections: validation, path traversal, call budget (per server run), per-IP rate limit.
// Starts its own server on a free port picked at run time with a fake key and an unreachable Qloo address (no real quota is used),
// and always stops it afterwards. Run: node --test test/server.test.mjs
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";

let PORT = 0;
let child;
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (method, path, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port: PORT, method, path, headers: { "content-type": "application/json" } }, (res) => {
    let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d }));
  });
  req.on("error", reject); if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body)); req.end();
});
const portOpen = () => new Promise((r) => { const s = net.connect(PORT, "127.0.0.1"); s.on("connect", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); });

before(async () => {
  PORT = await freePort();
  child = spawn("node", ["server/server.mjs"], {
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", QLOO_API_KEY: "fake-key-for-tests", QLOO_BASE: "http://127.0.0.1:9", QLOO_MONTHLY_BUDGET: "3" },
    stdio: "ignore",
  });
  for (let i = 0; i < 30 && !(await portOpen()); i++) await wait(100);
});
after(async () => { child.kill("SIGTERM"); for (let i = 0; i < 30 && (await portOpen()); i++) await wait(100); });

test("serves the page and health", async () => {
  assert.equal((await call("GET", "/")).status, 200);
  const h = JSON.parse((await call("GET", "/api/health")).body);
  assert.equal(h.ok, true); assert.equal(h.configured, true);
});
test("app files are served with the right types (manifest, icons, service worker)", async () => {
  const head = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).headers.get("content-type");
  assert.match(await head("/manifest.webmanifest"), /application\/manifest\+json/);
  assert.equal(await head("/icons/icon-192.png"), "image/png");
  assert.match(await head("/icons/icon.svg"), /image\/svg\+xml/);
  assert.match(await head("/sw.js"), /text\/javascript/);
  for (const p of ["/", "/js/app.js", "/sw.js", "/kb/i18n.json"]) assert.equal((await fetch(`http://127.0.0.1:${PORT}${p}`)).headers.get("cache-control"), "no-cache", p);
  assert.match((await fetch(`http://127.0.0.1:${PORT}/icons/icon-192.png`)).headers.get("cache-control"), /max-age/);
  for (const p of ["/", "/api/health"]) {
    const h = (await fetch(`http://127.0.0.1:${PORT}${p}`)).headers;
    assert.match(h.get("content-security-policy") || "", /frame-ancestors 'none'/, p);
    assert.equal(h.get("x-content-type-options"), "nosniff", p);
    assert.equal(h.get("x-frame-options"), "DENY", p);
    assert.match(h.get("strict-transport-security") || "", /max-age=31536000/, p);
  }
  const { createHash } = await import("node:crypto");
  // the policy itself, directive by directive: a widened or weakened policy fails here, not only a missing hash
  const cspNow = (await fetch(`http://127.0.0.1:${PORT}/`)).headers.get("content-security-policy");
  const dir = Object.fromEntries(cspNow.split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
  assert.deepEqual(Object.keys(dir).sort(), ["base-uri", "connect-src", "default-src", "font-src", "form-action", "frame-ancestors", "frame-src", "img-src", "object-src", "script-src", "style-src", "worker-src"]);
  assert.deepEqual(dir["default-src"], ["'self'"]);
  assert.deepEqual([dir["frame-ancestors"], dir["base-uri"], dir["object-src"], dir["form-action"]], [["'none'"], ["'none'"], ["'none'"], ["'self'"]]);
  assert.ok(!dir["script-src"].includes("'unsafe-inline'") && !dir["script-src"].includes("'unsafe-eval'"));
  assert.deepEqual(dir["script-src"].filter((t) => !t.startsWith("'sha256-")).sort(), ["'self'", "'wasm-unsafe-eval'", "blob:", "https://cdn.jsdelivr.net"]);
  assert.deepEqual([...dir["frame-src"]].sort(), ["https://maps.google.com", "https://www.google.com"]);
  assert.deepEqual(dir["connect-src"].filter((t) => /^https:\/\//.test(t)).sort(), ["https://*.hf.co", "https://*.huggingface.co", "https://cdn.jsdelivr.net", "https://huggingface.co"]);
  for (const name of ["script-src", "worker-src", "frame-src", "img-src"]) assert.ok(!dir[name].includes("https:") && !dir[name].includes("*"), name);
  const html = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
  const csp = (await fetch(`http://127.0.0.1:${PORT}/`)).headers.get("content-security-policy");
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi))
    assert.ok(csp.includes("'sha256-" + createHash("sha256").update(m[1]).digest("base64") + "'"), "an inline script is not allowed by the CSP hash");
  // every other page the app ships: an inline script would be blocked by the CSP (eval.html once was), so none is allowed there
  for (const f of ["eval.html", "sample_bookmarks.html", "sample_bookmarks.zh.html"]) {
    const page = await (await fetch(`http://127.0.0.1:${PORT}/${f}`)).text();
    for (const m of page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi))
      assert.ok(csp.includes("'sha256-" + createHash("sha256").update(m[1]).digest("base64") + "'"), f + " has an inline script that the CSP blocks");
  }
});
test("path traversal and hidden files are not served", async () => {
  for (const p of ["/..%2f.env", "/%2e%2e/.env", "/..%2fserver%2fserver.mjs", "/..%5c.env"]) {
    const r = await call("GET", p); assert.ok(r.status === 403 || r.status === 404, p + " -> " + r.status);
    assert.ok(!/QLOO_API_KEY|fake-key/.test(r.body), "leaked content for " + p);
  }
});
test("input validation", async () => {
  const ok = "urn:tag:category:place:spa";
  assert.equal((await call("POST", "/api/recommend", { city: "Atlantis", tags: [ok] })).status, 400);
  assert.equal((await call("POST", "/api/recommend", { city: "Taipei", tags: ["urn:tag:evil;drop"] })).status, 400);
  assert.equal((await call("POST", "/api/recommend", { city: "Taipei", tags: ["urn:tag:category:place:not_in_the_knowledge_base"] })).status, 400, "a well-formed tag the knowledge base does not know is refused");
  assert.equal((await call("POST", "/api/recommend", { city: "Taipei", tags: Array(13).fill(ok) })).status, 400);
  for (const raw of ["not json", "null", "[1]", "{"]) assert.equal((await call("POST", "/api/recommend", raw)).status, 400, raw); // never a 500 for a body that is not an object
  assert.equal((await call("POST", "/api/recommend", { city: "Taipei", tags: ["x".repeat(5000)] })).status, 413);
});
test("taste names are validated", async () => {
  const ok = "urn:tag:category:place:spa";
  for (const taste of [Array(6).fill("Cafe A"), ["x"], ["a".repeat(61)], [5], ["bad\nname"], "Cafe A"])
    assert.equal((await call("POST", "/api/recommend", { city: "Taipei", tags: [ok], taste })).status, 400, JSON.stringify(taste).slice(0, 40));
});
test("call budget guard returns 503 and never calls beyond the limit", async () => {
  const tags = ["urn:tag:category:place:spa", "urn:tag:category:place:hotel", "urn:tag:category:place:art_museum", "urn:tag:category:place:golf_course"];
  const statuses = []; let first;
  for (const t of tags) { const r = await call("POST", "/api/recommend", { city: "Taipei", tags: [t] }); statuses.push(r.status); first ||= r; }
  assert.equal(JSON.parse(first.body).groups[0].failed, true, "a failed Qloo request is marked failed, not shown as 'no listing'");
  assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
  assert.equal(statuses[3], 503);
  assert.equal("used" in JSON.parse((await call("GET", "/api/health")).body), false, "health must not publish how many requests others have made");
});
test("per-IP rate limit", async () => {
  const codes = [];
  for (let i = 0; i < 25; i++) codes.push((await call("POST", "/api/recommend", { city: "Atlantis", tags: [] })).status);
  assert.ok(codes.includes(429), "no 429 seen: " + codes.join(","));
});

// Behind a proxy the limit must be per visitor, not per proxy: own server with TRUST_PROXY=1 and forwarded addresses.
test("behind a proxy the rate limit counts each visitor separately (TRUST_PROXY=1), and ignores forged headers without it", async () => {
  const port = await freePort();
  const kid = spawn("node", ["server/server.mjs"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", QLOO_API_KEY: "", TRUST_PROXY: "1", QLOO_PER_IP_HOURLY: "5" }, stdio: "ignore" });
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { await wait(100); } }
    const post = (ip) => fetch(`http://127.0.0.1:${port}/api/recommend`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ city: "Taipei", tags: ["urn:tag:category:place:spa"] }) }).then((r) => r.status);
    const a = []; for (let i = 0; i < 22; i++) a.push(await post("203.0.113.7"));
    assert.ok(a.includes(429), "visitor A should be limited after 20 requests");
    assert.notEqual(await post("203.0.113.8"), 429, "visitor B behind the same proxy must not be limited by A");
    // the hourly allowance (5 lookups here) stops one address long before the per-minute limit of 20 would
    const h = []; for (let i = 0; i < 7; i++) h.push(await post("203.0.113.9"));
    assert.deepEqual(h.map((x) => x === 429), [false, false, false, false, false, true, true], "hourly allowance: " + h.join(","));
  } finally { kid.kill("SIGTERM"); }
  // without TRUST_PROXY a forged header must not buy a fresh allowance (own server, so earlier tests cannot have used up the limit)
  const port2 = await freePort();
  const kid2 = spawn("node", ["server/server.mjs"], { env: { ...process.env, PORT: String(port2), HOST: "127.0.0.1", QLOO_API_KEY: "", TRUST_PROXY: "0" }, stdio: "ignore" });
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${port2}/api/health`)).ok) break; } catch { await wait(100); } }
    const forged = [];
    for (let i = 0; i < 25; i++) forged.push((await fetch(`http://127.0.0.1:${port2}/api/recommend`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100." + i }, body: JSON.stringify({ city: "Taipei", tags: ["urn:tag:category:place:spa"] }) })).status);
    assert.ok(forged.includes(429), "forged X-Forwarded-For must not bypass the limit when TRUST_PROXY is off");
  } finally { kid2.kill("SIGTERM"); }
});

test("keep-alive outlasts a hosting proxy and the page has a stall safety net", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../server/server.mjs", import.meta.url), "utf8");
  assert.match(src, /keepAliveTimeout = 65000/); assert.match(src, /headersTimeout = 66000/);
  const html = (await import("node:fs")).readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(html, /__unsStarted/); assert.match((await import("node:fs")).readFileSync(new URL("../web/js/app.js", import.meta.url), "utf8"), /window\.__unsStarted = true/);
});
