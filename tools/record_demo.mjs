// Records the demo screen part (about 65 s) of the app as a video, from a clean private Chrome window driven over the DevTools protocol.
// It records only the web page (not the desktop), against the LOCAL server, in English and light mode, with the sample bookmarks.
// Scenes: landing, sample bookmarks and the privacy gate, ideas / taste / quality / what leaves the device, Find places, results,
// a click on a place's Map link (the map tab that opens is recorded too), the Evidence panel, the invitation and Invite a friend.
// Re-run it any day: node tools/record_demo.mjs   (the occasion line on the page follows the date)
// Needs: Google Chrome, ffmpeg, Node 22+ (global WebSocket), the local server running with a Qloo key.
// Output: docs/video_assets/screen_recording.mp4. Nothing is uploaded anywhere.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.DEMO_URL || "http://127.0.0.1:8770";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333, W = 1440, H = 900;
const OUT = new URL("../docs/video_assets/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(BASE + "/api/health")).json();
if (!health.configured) { console.error("ERROR the server at " + BASE + " has no Qloo key: the places step would fail. Aborting."); process.exit(1); }
if (!existsSync(CHROME)) { console.error("ERROR Chrome not found"); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "uns-rec-"));
const frameDir = mkdtempSync(join(tmpdir(), "uns-frames-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", "--mute-audio", "--lang=en-US", `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
const frames = []; let speed = 1, recording = false; const seen = new Map(); const sockets = [];

// One DevTools connection to one tab. Screencast frames from any tab go into the same timeline.
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); sockets.push(ws);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiting = new Map();
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method) seen.set(d.method, (seen.get(d.method) || 0) + 1);
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
    if (d.method === "Page.screencastFrame") {
      send("Page.screencastFrameAck", { sessionId: d.params.sessionId });
      if (recording) { const n = frames.length; writeFileSync(join(frameDir, `f${String(n).padStart(5, "0")}.jpg`), Buffer.from(d.params.data, "base64")); frames.push({ t: d.params.metadata.timestamp, speed }); }
    }
  };
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  return { ws, send, ev };
}
const pages = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");

try {
  let first;
  for (let i = 0; i < 50 && !first; i++) { try { first = (await pages())[0]; } catch { await sleep(200); } }
  if (!first) throw new Error("Chrome did not start");
  const main = await connect(first.webSocketDebuggerUrl);
  const { send, ev } = main;

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setLocaleOverride", { locale: "en-US" });
  const ua = (await send("Browser.getVersion")).result.userAgent.replace("HeadlessChrome", "Chrome");
  await send("Emulation.setUserAgentOverride", { userAgent: ua, acceptLanguage: "en-US,en" }); // makes navigator.language English
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"], origin: BASE });
  await send("Page.navigate", { url: BASE + "/" }); await sleep(2500);
  if ((await ev("document.documentElement.lang")) !== "en") { await ev("document.getElementById('lang').click()"); await sleep(600); }
  if ((await ev("document.documentElement.lang")) !== "en") throw new Error("the page is not in English; refusing to record");
  if (await ev("matchMedia('(prefers-color-scheme: dark)').matches")) throw new Error("the page is in dark mode; refusing to record");

  // a visible cursor (headless Chrome draws none)
  await ev(`(() => { const c = document.createElement('div'); c.id='demo-cursor'; c.style.cssText='position:fixed;z-index:99999;pointer-events:none;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(67,56,202,.28);border:2px solid #4338ca;left:-50px;top:-50px;transition:transform .12s';
    document.body.appendChild(c); document.addEventListener('mousemove', e => { c.style.left=e.clientX+'px'; c.style.top=e.clientY+'px'; });
    document.addEventListener('mousedown', () => c.style.transform='scale(.7)'); document.addEventListener('mouseup', () => c.style.transform='scale(1)'); })()`);

  let mx = W / 2, my = 120;
  const move = async (x, y, ms = 600) => { const steps = Math.max(8, Math.round(ms / 30)); for (let i = 1; i <= steps; i++) { const k = i / steps, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: mx + (x - mx) * e, y: my + (y - my) * e }); await sleep(ms / steps); } mx = x; my = y; };
  const rect = async (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2, r.top, r.bottom]; })()`);
  const scrollTo = async (sel, offset = 90, ms = 1100) => { await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - ${offset}, behavior: 'smooth' }); })()`); await sleep(ms); };
  const clickSel = async (sel) => { const r = await rect(sel); if (!r) throw new Error("missing " + sel); await move(r[0], r[1], 700);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r[0], y: r[1], button: "left", clickCount: 1 }); await sleep(90);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r[0], y: r[1], button: "left", clickCount: 1 }); await sleep(300); };
  const clickText = async (sel, re) => { const idx = await ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].findIndex(e => new RegExp(${JSON.stringify(re)}).test(e.textContent))`);
    if (idx < 0) throw new Error("no " + sel + " matching " + re); await clickSel(`${sel}:nth-of-type(${idx + 1})`); };

  // ---- recording starts ----
  recording = true; await send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  // S1 landing, 10 s
  await move(W * 0.62, 150, 900); await sleep(2200); await scrollTo(".flow", 120, 1400); await sleep(2600);
  await ev("window.scrollTo({top:0,behavior:'smooth'})"); await sleep(1500);
  // S2 sample bookmarks and the gate, 13 s
  await clickSel("#sample"); await sleep(2000); await scrollTo("#s2", 70, 1200); await sleep(7000);
  // S3 ideas, extension, taste and quality, payload, 17 s
  await scrollTo("#s4", 60, 1200); await sleep(4500); await scrollTo("#expandBox", 80, 1100); await sleep(1800);
  await scrollTo("#tasteBox", 120, 1000); await clickText("#taste .chip", "Simple Kaffa"); await sleep(900);
  await clickSel("#quality"); await sleep(900); await scrollTo(".payload", 200, 1100); await sleep(5000);
  // S4 find places (the wait is sped up), results
  await clickSel("#go"); speed = 5;
  for (let i = 0; i < 120; i++) { const ready = await ev("document.querySelectorAll('.res').length > 0 && !document.querySelector('.skeleton')"); if (ready) break; await sleep(500); }
  speed = 1; await sleep(500); await scrollTo("#s5", 60, 1200); await sleep(3800);
  await ev("window.scrollBy({top: 330, behavior: 'smooth'})"); await sleep(2600);

  // S4b the Map link: click it, record the map tab that opens, close it, come back
  const before = new Set((await pages()).map((p) => p.id));
  await ev("document.querySelector('a.pl-map').scrollIntoView({behavior:'smooth', block:'center'})"); await sleep(1300);
  await clickSel("a.pl-map");
  let tab; for (let i = 0; i < 40 && !tab; i++) { tab = (await pages()).find((p) => !before.has(p.id)); if (!tab) await sleep(250); }
  if (tab) {
    const map = await connect(tab.webSocketDebuggerUrl);
    await map.send("Page.enable"); await map.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await map.send("Emulation.setUserAgentOverride", { userAgent: ua, acceptLanguage: "en-US,en" });
    await main.send("Page.stopScreencast");
    await map.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
    await sleep(5500);
    await map.send("Page.stopScreencast");
    await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`).catch(() => {}); map.ws.close();
    await sleep(500);
    await main.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 }); await sleep(900);
  } else console.log("note: no map tab opened, scene skipped");

  // S4c Evidence panel
  await clickSel(".evid summary"); await sleep(600); await ev("document.querySelector('.evid').scrollIntoView({behavior:'smooth', block:'center'})"); await sleep(3200);
  // S5 invitation and invite a friend
  await scrollTo(".invite", 90, 1100); await sleep(1500); await clickSel("#inviteBtn"); await sleep(2600);
  await send("Page.stopScreencast"); recording = false;

  console.log("protocol events seen:", JSON.stringify([...seen].filter(([k]) => k.startsWith("Page.screencast"))));
  if (!frames.length) throw new Error("no screencast frames were received");

  // ---- assemble: each frame lasts until the next one (a waiting stretch is shown at 5x), then 30 fps ----
  const list = [];
  for (let i = 0; i < frames.length; i++) { const dur = i + 1 < frames.length ? Math.min((frames[i + 1].t - frames[i].t) / frames[i].speed, 4) : 1.5; list.push(`file 'f${String(i).padStart(5, "0")}.jpg'`, `duration ${dur.toFixed(4)}`); }
  list.push(`file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'`);
  writeFileSync(join(frameDir, "list.txt"), list.join("\n"));
  const out = join(OUT, "screen_recording.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(frameDir, "list.txt"), "-vf", `fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p`, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-an", out]);
  const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString().trim();
  console.log(`recorded ${frames.length} frames -> ${out} (${Number(dur).toFixed(1)} s)`);
} catch (e) {
  console.error("ERROR " + (e && e.stack || e)); process.exitCode = 1;
} finally {
  for (const w of sockets) { try { w.close(); } catch {} }
  chrome.kill("SIGTERM"); await sleep(600);
  rmSync(profile, { recursive: true, force: true }); rmSync(frameDir, { recursive: true, force: true });
}
