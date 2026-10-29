import { parseBookmarks, runGate } from "./gate.js";
import { loadKb, rankActivities, unmatched } from "./combine.js";
import { supported, loadEmbedder, buildIndex, matchItems } from "./embed.js";
import { expand, loadExpansion } from "./expand.js";
import { waiting } from "./waiting.js";
import { loadPlaceNames, placeName, hasForm } from "./names.js";
import { loadCalendar, upcoming, isoDay, weekSeed, rotate } from "./calendar.js";
import { activityIcon, glyph } from "./icons.js";
import { candidateNames, MAX_TASTE } from "./taste.js";
import { renderThemeMenu, applyTheme, savedTheme, bindMenuKeys } from "./themes.js";

const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PALETTE = ["#d97706", "#e11d48", "#7c3aed", "#0891b2", "#64748b", "#a16207", "#be185d", "#4d7c0f"];
let i18n = null, cities = [];
// The language the visitor chose stays chosen on the next visit (localStorage, this browser only); otherwise the browser's language decides.
const LANG_KEY = "uns-lang";
const savedLang = () => { try { const v = localStorage.getItem(LANG_KEY); return v === "zh" || v === "en" ? v : null; } catch (e) { return null; } };
let lang = savedLang() || ((navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en");
const MAX_TAGS = 12; // the server refuses more than this in one lookup (server/server.mjs, /api/recommend)
const state = { kept: [], counts: {}, total: 0, chosen: [], kb: [], ideas: [], results: null, step: 1, tasteOn: [], exp: null, suggestions: [], extraOn: [], cal: null, placeNames: {} };

const ui = (k) => i18n.ui[k][lang];
const kbName = (name) => { const a = state.kb.find((x) => x.tag_id === name); return a ? a.activity : name; };
const act = (raw) => { const name = kbName(raw); return lang === "zh" && i18n.activities[name] ? i18n.activities[name].zh : name; };
const need = (k) => i18n.needs[k][lang];
const reason = (k) => (i18n.reasons[k] ? i18n.reasons[k][lang] : k);
const icon = (name) => activityIcon(name);
const sep = () => (lang === "zh" ? "、" : ", ");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function setStep(n) {
  state.step = n;
  document.querySelectorAll("#stepper li").forEach((li) => {
    const s = Number(li.dataset.s);
    li.classList.toggle("done", s < n);
    li.classList.toggle("on", s === n);
  });
}

function countUp(el, to) {
  if (REDUCED || to === 0) { el.textContent = to; return; }
  const t0 = performance.now(), D = 600;
  const tick = (t) => { const p = Math.min(1, (t - t0) / D); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

function renderCities() {
  const cur = $("city").value || "Taipei";
  $("city").innerHTML = cities.map((c) => `<option value="${esc(c.en)}">${esc(lang === "zh" ? c.zh : c.en)}${c.coverage < 20 ? " (" + ui("limited") + ")" : ""}</option>`).join("");
  $("city").value = cities.some((c) => c.en === cur) ? cur : "Taipei";
}

function applyStatic() {
  document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = ui(el.dataset.i18n); });
  $("h1").innerHTML = ui("tagline_html");
  $("aiHelp").textContent = supported() ? ui("ai_help") : ui("ai_unsupported");
  document.title = ui("title");
  $("lang").textContent = ui("lang");
  renderCities();
  renderThemeMenu(lang, ui("theme_default"), () => {});
}

function renderStats(animate) {
  const removed = state.total - state.kept.length;
  if (animate) { countUp($("nRead"), state.total); countUp($("nRem"), removed); countUp($("nKept"), state.kept.length); }
  else { $("nRead").textContent = state.total; $("nRem").textContent = removed; $("nKept").textContent = state.kept.length; }
  const entries = Object.entries(state.counts).sort((a, b) => b[1] - a[1]);
  const pct = (n) => (state.total ? (n / state.total) * 100 : 0);
  $("bar").innerHTML = `<i style="width:${pct(state.kept.length)}%;background:var(--keep)"></i>` +
    entries.map(([r, n], k) => `<i style="width:${pct(n)}%;background:${PALETTE[k % PALETTE.length]}"></i>`).join("");
  $("bar").setAttribute("aria-label", `${ui("kept")} ${state.kept.length} / ${state.total}`);
  $("legend").innerHTML = `<li><span class="dot" style="background:var(--keep)"></span>${esc(ui("kept"))}<b>${state.kept.length}</b></li>` +
    entries.map(([r, n], k) => `<li><span class="dot" style="background:${PALETTE[k % PALETTE.length]}"></span>${esc(reason(r))}<b>${n}</b></li>`).join("");
}

function renderNeeds() {
  $("needs").innerHTML = Object.keys(i18n.needs).map((k) => `<button class="chip" type="button" aria-pressed="${state.chosen.includes(k)}" data-k="${k}">${esc(need(k))}</button>`).join("");
  $("needs").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.k;
    state.chosen = state.chosen.includes(k) ? state.chosen.filter((x) => x !== k) : [...state.chosen, k];
    renderNeeds();
    refreshIdeas();
  }));
}

// Ideas keep their ticked state across re-ranking
function refreshIdeas() {
  const off = new Set(state.ideas.filter((x) => !x.on).map((x) => x.activity));
  state.ideas = rankActivities(state.kept, state.kb, state.chosen).slice(0, 8).map((r) => ({ ...r, on: !off.has(r.activity) }));
  renderIdeas();
  renderExpand();
  renderTaste();
  updatePayload();
}

function currentOccasion() {
  return state.cal ? upcoming(state.cal, isoDay(new Date()), $("city").value || "Taipei") : null;
}

function occasionName(id) { const e = state.cal.entries.find((x) => x.id === id); return e ? e[lang] === undefined ? e.zh : e[lang] : id; }

function renderExpand() {
  state.suggestions = state.exp ? expand(state.ideas.filter((x) => x.on), state.kb, state.exp) : [];
  const occ = currentOccasion();
  if (occ) { // the occasion's own ideas come first, unless they are already ideas
    const have = new Set([...state.ideas.map((x) => x.activity), ...state.suggestions.map((x) => x.activity)]);
    const mine = occ.entry.acts.filter((n) => !have.has(n)).map((n) => state.kb.find((a) => a.activity === n)).filter(Boolean)
      .map((a) => ({ activity: a.activity, tag_id: a.tag_id, path: "occasion", from: occ.entry.id }));
    state.suggestions = [...mine, ...state.suggestions].slice(0, 6);
  }
  const names = new Set(state.suggestions.map((x) => x.activity));
  state.extraOn = state.extraOn.filter((n) => names.has(n));
  $("expandBox").classList.toggle("hide", !state.suggestions.length);
  $("expand").innerHTML = state.suggestions.map((s, k) =>
    `<label class="idea ${state.extraOn.includes(s.activity) ? "on" : ""}"><input type="checkbox" data-k="${k}" ${state.extraOn.includes(s.activity) ? "checked" : ""}>
      <span class="emo" aria-hidden="true">${icon(s.activity)}</span>
      <span><span class="t">${esc(act(s.activity))}</span><span class="w"><span class="src need">${esc(ui("path_" + s.path))}</span><span class="src bm">${s.path === "occasion" ? esc(occasionName(s.from)) : esc(ui("expand_from")) + " " + esc(act(s.from))}</span></span></span></label>`).join("");
  $("expand").querySelectorAll("input").forEach((c) => c.addEventListener("change", () => {
    const n = state.suggestions[Number(c.dataset.k)].activity;
    state.extraOn = c.checked ? [...state.extraOn, n] : state.extraOn.filter((x) => x !== n);
    renderExpand();
    updatePayload();
  }));
}

function renderTaste() {
  const cands = candidateNames(state.kept, state.ideas, state.kb);
  const names = new Set(cands.map((c) => c.name));
  state.tasteOn = state.tasteOn.filter((n) => names.has(n));
  $("tasteBox").classList.toggle("hide", !cands.length);
  $("taste").innerHTML = cands.map((c) =>
    `<button class="chip" type="button" aria-pressed="${state.tasteOn.includes(c.name)}" data-n="${esc(c.name)}" title="${esc(act(c.activity))}">${esc(c.name)}</button>`).join("");
  $("taste").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    const n = b.dataset.n;
    if (state.tasteOn.includes(n)) state.tasteOn = state.tasteOn.filter((x) => x !== n);
    else if (state.tasteOn.length < MAX_TASTE) state.tasteOn = [...state.tasteOn, n];
    else { b.title = ui("taste_limit"); return; }
    renderTaste();
    updatePayload();
  }));
}

function sourceChips(r) {
  const out = [];
  const w = waiting(state.kept, [{ activity: r.activity, on: true }], state.kb)[0];
  if (w) out.push(`<span class="src need">${glyph("bookmark", "ic xs")} ${esc(ui("waiting_chip").replace("{months}", w.months))}</span>`);
  if (r.hits) out.push(`<span class="src bm">${glyph("bookmark", "ic xs")} ${r.hits} ${esc(ui("mentions"))}</span>`);
  if (r.chosen.length) out.push(`<span class="src need">${glyph("target", "ic xs")} ${esc(ui("src_need"))}: ${esc(r.chosen.map(need).join(sep()))}</span>`);
  return out.join("");
}

function renderIdeas() {
  if (!state.ideas.length) { $("ideas").innerHTML = `<div class="empty">${esc(ui("nomatch"))}</div>`; $("go").disabled = true; return; }
  $("ideas").innerHTML = state.ideas.map((r, k) =>
    `<label class="idea ${r.on ? "on" : ""}"><input type="checkbox" data-k="${k}" ${r.on ? "checked" : ""}>
      <span class="emo" aria-hidden="true">${icon(r.activity)}</span>
      <span><span class="t">${esc(act(r.activity))}</span><span class="w">${sourceChips(r)}</span></span></label>`).join("");
  $("ideas").querySelectorAll("input").forEach((c) => c.addEventListener("change", () => {
    state.ideas[Number(c.dataset.k)].on = c.checked;
    renderIdeas();
    renderExpand();
    renderTaste();
    updatePayload();
  }));
}

function updatePayload() {
  const body = { city: $("city").value, tags: [...new Set([...state.ideas.filter((x) => x.on).map((x) => x.tag_id), ...state.suggestions.filter((x) => state.extraOn.includes(x.activity)).map((x) => x.tag_id)])] };
  if (state.tasteOn.length) { body.taste = [...state.tasteOn]; body.heatmap = true; } // the taste heatmap uses the same city and names, nothing more
  if ($("quality").checked) body.quality = true;
  $("payload").textContent = JSON.stringify(body, null, 1);
  const extra = body.tags.length - MAX_TAGS; // too many: say how many to uncheck instead of sending a lookup the server will refuse
  $("goNote").textContent = extra > 0 ? ui("too_many").replace("{max}", MAX_TAGS).replace("{n}", body.tags.length).replace("{extra}", extra) : "";
  $("goNote").classList.toggle("hide", extra <= 0);
  $("go").disabled = !body.tags.length || extra > 0;
  saveSession();
  return body;
}

// Session state, so coming back from another page restores where you were. Kept in THIS tab only (sessionStorage, cleared when the
// tab closes). Removed bookmarks are never stored, only what the page already shows; nothing here is sent anywhere.
const SESSION_KEY = "uns-session";
function saveSession() {
  if (!state.total) return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ v: 1, lang, total: state.total, counts: state.counts,
      kept: state.kept.map((it) => ({ title: it.title, host: it.host, added: it.added || 0, hints: it.hints || [] })),
      chosen: state.chosen, off: state.ideas.filter((x) => !x.on).map((x) => x.activity), extraOn: state.extraOn, tasteOn: state.tasteOn,
      quality: $("quality").checked, city: $("city").value, results: state.results, step: state.step, scroll: scrollY }));
  } catch (e) { /* storage blocked or full: the page still works, it just will not restore */ }
}
function restoreSession() {
  let s; try { s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) { s = null; }
  if (!s || s.v !== 1 || !s.total) return false;
  if (s.lang && s.lang !== lang) { lang = s.lang; applyStatic(); }
  Object.assign(state, { kept: s.kept, counts: s.counts, total: s.total, chosen: s.chosen || [], ideas: [], extraOn: s.extraOn || [], tasteOn: s.tasteOn || [], results: s.results || null });
  for (const id of ["s2", "s3", "s4", "s2b"]) $(id).classList.remove("hide");
  $("aiBtn").classList.toggle("hide", !supported());
  $("city").value = s.city || "Taipei"; $("quality").checked = !!s.quality;
  renderStats(false); renderNeeds();
  refreshIdeas();
  state.ideas.forEach((x) => { x.on = !(s.off || []).includes(x.activity); }); // the ticks the visitor had
  renderIdeas(); renderExpand(); renderTaste(); updatePayload();
  if (state.results) { $("s5").classList.remove("hide"); renderResults(); }
  const step = s.step || 3;
  setStep(step); history.replaceState({ step }, "", "#step" + step);
  requestAnimationFrame(() => scrollTo(0, s.scroll || 0));
  return true;
}

// Every place is listed once, under the first idea that returned it; other ideas that also returned it are shown as small tags.
// A forward-looking invitation (history cannot be replayed): the next Saturday, the first need of the top idea, up to two ideas that serve it.
function nextSaturday() {
  const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d.toLocaleDateString(lang === "zh" ? "zh-TW" : "en-GB", { month: "numeric", day: "numeric", weekday: "short" });
}
function inviteHtml(groups) {
  const inv = i18n.invite, today = isoDay(new Date());
  const occ = state.results && state.results.city ? upcoming(state.cal, today, state.results.city) : null;
  const acts = groups.filter((g) => g.places.length).map((g) => state.kb.find((a) => a.activity === g.activity)).filter(Boolean);
  // an activity is grouped under a need the visitor chose if it serves one, otherwise under its own first need
  const needOf = (a) => a.functions.find((f) => state.chosen.includes(f)) || (inv.hooks[a.activity] && inv.hooks[a.activity].need) || a.functions[0];
  const byNeed = new Map();
  acts.forEach((a) => { const n = needOf(a); if (!byNeed.has(n)) byNeed.set(n, []); byNeed.get(n).push(a); });
  let order = [...byNeed];
  // With an occasion coming up the invitation follows the calendar (its activities first); otherwise it rotates once a week.
  if (occ) order.sort((x, y) => Number(y[1].some((a) => occ.entry.acts.includes(a.activity))) - Number(x[1].some((a) => occ.entry.acts.includes(a.activity))));
  else order = rotate(order, weekSeed(today));
  // What the visitor chose for themselves comes first, ahead of the calendar and the weekly rotation (the sort is stable).
  order.sort((x, y) => Number(state.chosen.includes(y[0])) - Number(state.chosen.includes(x[0])));
  const hook = (a) => (inv.hooks[a.activity] ? inv.hooks[a.activity][lang] : act(a.activity));
  const lines = order.slice(0, 3).map(([need, list], i) => {
    const ranked = occ ? [...list].sort((x, y) => Number(occ.entry.acts.includes(y.activity)) - Number(occ.entry.acts.includes(x.activity))) : rotate(list, weekSeed(today));
    const pick = ranked.slice(0, 2), two = pick.length > 1;
    const tpl = ui(i === 0 ? (two ? "invite_two" : "invite_one") : (two ? "invite_more_two" : "invite_more_one"));
    return tpl.replace("{verb}", inv.verbs[need][lang]).replace("{a}", hook(pick[0])).replace("{b}", two ? hook(pick[1]) : "");
  });
  if (!lines.length) return "";
  let head = `${ui("invite_title")} · ${nextSaturday()}`, ritual = "";
  if (occ) {
    const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(lang === "zh" ? "zh-TW" : "en-GB", { month: "numeric", day: "numeric" });
    const e = occ.entry, date = e.start === e.end ? fmt(e.start) : `${fmt(e.start)}–${fmt(e.end)}`;
    const when = occ.days === 0 ? ui("occasion_now") : ui("occasion_in").replace("{n}", occ.days);
    head = ui("occasion_line").replace("{when}", when).replace("{name}", e[lang]).replace("{date}", date);
    const prep = e.prep && occ.days > 0 ? `<p class="ritual"><span>${esc(ui("prep_label"))}</span> ${esc(e.prep[lang])}</p>` : "";
    ritual = prep + `<p class="ritual"><span>${esc(ui("ritual_label"))}</span> ${esc(e.ritual[lang])}</p>`;
  }
  const mode = occ ? ui("mode_calendar") : ui("mode_weekly");
  const waits = waiting(state.kept, state.ideas, state.kb);
  if (waits.length) ritual = `<p class="ritual"><span>${esc(ui("waiting_label"))}</span> ${esc(ui("waiting_line").replace("{months}", waits[0].months).replace("{title}", waits[0].title))}</p>` + ritual;
  // The invitation text is composed here from the first idea and its first place; the visitor sends it wherever they like. Nothing is sent by this page.
  const firstGroup = groups.find((g) => g.places.length);
  state.inviteText = ui("invite_msg").replace("{when}", occ ? head.replace(/^[^：:]+[：:]\s*/, "") : nextSaturday()).replace("{line}", lines[0]).replace("{place}", firstGroup.places[0].name);
  return `<aside class="invite"><b>${esc(head)}</b> <span class="fine">· ${esc(mode)}</span>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}${ritual}<p class="fine">${esc(ui("invite_step"))}</p><button class="btn" id="inviteBtn" type="button">${esc(ui("invite_friend"))}</button> <span class="fine" id="inviteDone"></span></aside>`;
}

// Taste heatmap card: Qloo's strongest cells for the saved places' taste, drawn as dots over the city's bounding box (no map tiles, nothing
// else is loaded), with the places on this page marked where they fall inside it. Sizes and opacity follow Qloo's affinity for the cell.
function heatHtml(heat, groups) {
  if (!heat) return "";
  const t = state.results.taste || { used: [] }, names = t.used.map((x) => x.name).join(sep()), city = cityName(state.results.city);
  const head = `<h3><span class="emo" aria-hidden="true">${glyph("map-pin", "ic")}</span>${esc(ui("heat_title").replace("{names}", names).replace("{city}", city))}</h3>`;
  if (heat.failed || !heat.cells.length) return `<article class="res"> ${head}<p class="fine">${esc(ui(heat.failed ? "heat_failed" : "heat_none"))}</p></article>`;
  const W = 640, H = 360, PAD = 18;
  const lats = heat.cells.map((c) => c.lat), lons = heat.cells.map((c) => c.lon);
  const lat0 = Math.min(...lats), lat1 = Math.max(...lats), lon0 = Math.min(...lons), lon1 = Math.max(...lons);
  const x = (lon) => PAD + ((lon - lon0) / ((lon1 - lon0) || 1)) * (W - 2 * PAD), y = (lat) => H - PAD - ((lat - lat0) / ((lat1 - lat0) || 1)) * (H - 2 * PAD);
  const top = heat.cells[0].affinity || 1;
  const dots = heat.cells.map((c) => { const a = top ? c.affinity / top : 1; return `<circle cx="${x(c.lon).toFixed(1)}" cy="${y(c.lat).toFixed(1)}" r="${(6 + 14 * a).toFixed(1)}" fill="var(--accent)" fill-opacity="${(0.12 + 0.3 * a).toFixed(2)}"/>`; }).join("");
  const inside = (p) => p.loc && p.loc.lat >= lat0 && p.loc.lat <= lat1 && p.loc.lon >= lon0 && p.loc.lon <= lon1;
  const marks = groups.flatMap((g) => g.places.filter(inside).slice(0, 1)).slice(0, 12).map((p) =>
    `<g><title>${esc(placeName(p.name, lang, state.placeNames))}</title><circle cx="${x(p.loc.lon).toFixed(1)}" cy="${y(p.loc.lat).toFixed(1)}" r="5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/></g>`).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ui("heat_alt"))}" style="display:block;width:100%;height:auto;background:var(--soft);border-radius:calc(var(--r)*.7)">${dots}${marks}</svg>`;
  return `<article class="res">${head}${svg}<p class="fine">${esc(ui("heat_help").replace("{n}", heat.cells.length).replace("{total}", heat.total))}</p></article>`;
}
function cityName(en) { const c = cities.find((x) => x.en === en); return c ? (lang === "zh" ? c.zh : c.en) : en; }

function evidenceHtml(trace) {
  if (!trace || !trace.length) return "";
  const rows = trace.map((t) => {
    const p = Object.entries(t.params).map(([k, v]) => `${k}=${v}`).join("&");
    return `<code><b>GET ${esc(t.endpoint)}</b> ${esc(p)}<br>→ ${t.status} · ${t.cached ? esc(ui("evidence_cached")) : t.ms + " ms"} · ${t.count ?? "?"} ${esc(ui("evidence_results"))}</code>`;
  }).join("");
  return `<details class="evid"><summary>${esc(ui("evidence_title"))} (${trace.length})</summary><p class="fine">${esc(ui("evidence_help"))}</p>${rows}</details>`;
}

// One line per place that says why it is here. Ranked by a saved place: that place, Qloo's affinity for this one, and the descriptive tags
// the two share. Otherwise the place's own traits, so two places under the same idea never carry the same line.
function whyHtml(p) {
  const parts = [];
  if ((p.because || []).length) parts.push(`${ui("because")} ${p.because.join(sep())}` + (typeof p.affinity === "number" ? ` (${p.affinity}% ${ui("affinity")})` : ""));
  if ((p.because || []).length && (p.shared || []).length) parts.push(`${ui("shares")} ${p.shared.join(sep())}`);
  else if ((p.traits || []).length) parts.push(`${ui("matches")} ${p.traits.join(sep())}`);
  return parts.length ? `<span class="why">${esc(parts.join(" · "))}</span>` : "";
}

function renderResults() {
  if (!state.results) return;
  const groups = state.results.groups;
  const where = new Map();
  groups.forEach((g, gi) => g.places.forEach((p) => { if (!where.has(p.name)) where.set(p.name, []); where.get(p.name).push(gi); }));
  const t = state.results.taste || { used: [], unknown: [] };
  const changed = groups.reduce((n, g) => n + (g.plain ? g.places.filter((p) => !g.plain.includes(p.name)).length : 0), 0);
  const relaxed = groups.filter((g) => g.relaxed).map((g) => act(g.activity));
  const untasted = groups.filter((g) => g.untasted).map((g) => act(g.activity));
  const note = (t.used.length ? `<p class="fine">${esc(ui("taste_used"))} ${esc(t.used.map((x) => x.name).join(sep()))} · ${changed} ${esc(ui("taste_differs"))}</p>` : "") +
    (state.results.quality && !t.used.length ? `<p class="fine">${esc(ui("quality"))} · ${changed} ${esc(ui("quality_changed"))}</p>` : "") +
    (relaxed.length ? `<p class="fine">${esc(ui("quality_relaxed"))} ${esc(relaxed.join(sep()))}</p>` : "") +
    (untasted.length ? `<p class="fine">${esc(ui("taste_untasted"))} ${esc(untasted.join(sep()))}</p>` : "") +
    (t.unknown.length ? `<p class="fine">${esc(ui("taste_unknown"))} ${esc(t.unknown.join(sep()))}</p>` : "");
  $("results").innerHTML = inviteHtml(groups) + note + heatHtml(state.results.heat, groups) + groups.map((g, gi) => {
    const mine = g.places.filter((p) => where.get(p.name)[0] === gi);
    const dup = g.places.filter((p) => where.get(p.name)[0] !== gi);
    const via = g.via ? `<p class="fine"><span class="tag">${esc(ui("shared").replace(/[()（）]/g, ""))}</span> ${esc(g.via.replace(/ \(shared courts\)$/, "").split(" and ").map(act).join(sep()))}</p>` : "";
    let body;
    if (mine.length) {
      body = "<ul>" + mine.map((p) => {
        const others = where.get(p.name).slice(1).map((o) => act(groups[o].activity));
        const why = whyHtml(p);
        const shown = placeName(p.name, lang, state.placeNames);
        const about = lang === "en" && !hasForm(p.name, "en", state.placeNames) && (p.about || p.area) ? `<span class="pl-about">${esc([p.about, p.area].filter(Boolean).join(" · "))}</span>` : "";
        const full = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&query_place_id=${encodeURIComponent(p.place_id || "")}&hl=${lang === "zh" ? "zh-TW" : "en"}`;
        const map = p.place_id ? ` <a class="pl-map" href="${full}" data-name="${esc(shown)}" data-q="${esc(p.name + (p.area ? " " + p.area : ""))}" target="_blank" rel="noopener noreferrer">${esc(ui("open_map"))}</a>` : "";
        return `<li><span title="${esc(p.name)}">${esc(shown)}${map}${about}${why}${others.length ? `<span class="also">${esc(ui("also"))}: ${esc(others.join(sep()))}</span>` : ""}</span></li>`;
      }).join("") + "</ul>";
    } else if (dup.length) {
      const firsts = [...new Set(dup.map((p) => act(groups[where.get(p.name)[0]].activity)))];
      body = `<p class="same">${esc(ui("same_as"))} ${esc(firsts.join(sep()))}</p>`;
    } else body = `<p class="fine">${esc(ui("noplaces"))}</p>`;
    return `<article class="res"><h3><span class="emo" aria-hidden="true">${icon(g.activity)}</span>${esc(act(g.activity))}</h3>${via}${body}</article>`;
  }).join("") + evidenceHtml(state.results.trace);
}

async function runAI() {
  $("aiBtn").disabled = true;
  $("aiProg").classList.remove("hide");
  try {
    $("aiStatus").textContent = ui("ai_loading") + " 0%";
    const ext = await loadEmbedder((p) => { $("aiStatus").textContent = `${ui("ai_loading")} ${Math.round(p * 100)}%`; $("aiProg").value = p; });
    const vocab = await (await fetch("kb/vocab.json")).json();
    const index = await buildIndex(ext, state.kb, vocab);
    const todo = unmatched(state.kept, state.kb);
    const before = new Set(rankActivities(state.kept, state.kb, state.chosen).map((r) => r.activity));
    const matches = await matchItems(ext, index, todo, { onStep: (i, n) => { $("aiStatus").textContent = `${ui("ai_working")} ${i}/${n}`; $("aiProg").value = n ? i / n : 1; } });
    for (const m of matches) m.item.hints = [m.activity];
    refreshIdeas();
    const found = rankActivities(state.kept, state.kb, state.chosen).map((r) => r.activity).filter((x) => !before.has(x));
    $("aiStatus").textContent = `${ui("ai_done")} ${todo.length}. ${ui("ai_matched")} ${matches.length}. ${ui("ai_found")} ${found.length ? found.map(act).join(sep()) : "0"}`;
  } catch (e) {
    $("aiStatus").textContent = ui("ai_error");
    $("aiBtn").disabled = false;
  } finally { $("aiProg").classList.add("hide"); }
}

async function sendInvite() {
  try {
    // phones get the share sheet; a desktop only copies the text (a share sheet there looks like it is about to send something)
    if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ text: state.inviteText }); return; }
    await navigator.clipboard.writeText(state.inviteText);
    $("inviteDone").textContent = ui("invite_friend_done");
  } catch (e) { /* share sheet dismissed or clipboard blocked: nothing to do */ }
}

// Each step is a history entry: Back returns to the previous step and keeps what you loaded; it never leaves the page.
function pushStep(n) { if ((history.state || {}).step !== n) history.pushState({ step: n }, "", "#step" + n); }
// A new frame each time: changing an existing frame's address adds entries to the browser history, and then Back would move inside
// the map instead of closing it. Removing the frame drops those entries.
function freshFrame(url) {
  const f = document.createElement("iframe");
  f.id = "mapFrame"; f.title = "map"; f.referrerPolicy = "no-referrer";
  if (url) f.src = url;
  $("mapFrame").replaceWith(f);
}
// Clear everything this page keeps in the browser (the saved session, the offline copy, the style choice) and start fresh.
async function clearData() {
  try { sessionStorage.clear(); } catch (e) { /* blocked */ }
  try { localStorage.removeItem("uns-theme"); localStorage.removeItem(LANG_KEY); } catch (e) { /* blocked */ }
  try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch (e) { /* blocked */ }
  try { if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (e) { /* blocked */ }
  location.replace(location.pathname);
}
// The map opens inside the page (the visitor never leaves, so nothing is lost); Back, Esc or the Back button close it.
function openMap(a) {
  $("mapTitle").textContent = a.dataset.name;
  $("mapFull").href = a.href;
  freshFrame(`https://maps.google.com/maps?q=${encodeURIComponent(a.dataset.q)}&hl=${lang === "zh" ? "zh-TW" : "en"}&z=16&output=embed`);
  $("mapPanel").classList.remove("hide");
  history.pushState({ step: (history.state || {}).step || 4, map: true }, "", location.hash || "#step4");
  $("mapBack").focus();
}
function closeMap(fromHistory) {
  if ($("mapPanel").classList.contains("hide")) return;
  $("mapPanel").classList.add("hide");
  freshFrame(null);
  if (!fromHistory && (history.state || {}).map) history.back();
}
function onBack(e) {
  if (!$("mapPanel").classList.contains("hide")) { closeMap(true); return; } // Back while the map is open only closes the map
  const n = (e.state || {}).step || 1;
  if (n < 4) $("s5").classList.add("hide");                 // leaving the places step: hide the results, keep the ideas
  if (n >= 4 && state.results) $("s5").classList.remove("hide"); // Forward again: show the results that are already there
  const target = n >= 4 ? "s5" : n === 3 ? "s4" : "s1";
  setStep(n === 1 && state.total ? 3 : n);
  $(target).scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
}

async function go() {
  const body = updatePayload();
  $("s5").classList.remove("hide");
  $("results").innerHTML = body.tags.map(() => '<div class="skeleton"></div>').join("");
  setStep(4);
  pushStep(4);
  $("s5").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
  // Each failure says what happened (and its code), so a visitor on a phone can tell a dropped connection from a refused lookup.
  const fail = (key, code) => { $("results").innerHTML = `<p class="fine">${esc(ui(key))}${code ? esc(ui("err_code").replace("{code}", code)) : ""}</p>`; };
  if (body.tags.length > MAX_TAGS) return fail("err_request");
  let r;
  try { r = await fetch("/api/recommend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
  catch (e) { return fail("err_network"); }
  if (!r.ok) {
    let error = ""; try { error = (await r.json()).error || ""; } catch (e) { /* not JSON: a proxy page */ }
    const key = r.status === 400 || r.status === 413 ? "err_request" : r.status === 429 ? "err_slow"
      : r.status === 503 ? (error === "budget" ? "err_budget" : "offline") : "err_server";
    return fail(key, r.status);
  }
  try { state.results = await r.json(); } catch (e) { return fail("err_network"); } // the body was cut off on the way
  state.results.city = body.city;
  renderResults();
  saveSession();
}

function start(html) {
  const { kept, counts, total } = runGate(parseBookmarks(html));
  Object.assign(state, { kept, counts, total, results: null, ideas: [], tasteOn: [], extraOn: [], suggestions: [] });
  for (const id of ["s2", "s3", "s4"]) $(id).classList.remove("hide");
  $("s2b").classList.remove("hide");
  $("aiBtn").disabled = false;
  $("aiStatus").textContent = "";
  $("aiBtn").classList.toggle("hide", !supported());
  $("s5").classList.add("hide");
  renderStats(true);
  renderNeeds();
  refreshIdeas();
  setStep(3);
  pushStep(3);
}

const BUILD = "2026-10-29.1"; // must match <meta name="build"> in index.html and VERSION in sw.js
function sameBuild() {
  const page = document.querySelector('meta[name="build"]')?.content;
  if (page === BUILD) { try { sessionStorage.removeItem("uns-reloaded"); } catch (e) { /* blocked */ } return true; }
  let tried = false; try { tried = sessionStorage.getItem("uns-reloaded") === BUILD; sessionStorage.setItem("uns-reloaded", BUILD); } catch (e) { /* blocked */ }
  if (!tried) location.reload(); // an old page with new code (or the reverse): fetch both again, once
  return tried;
}

async function init() {
  if (!sameBuild()) return;
  window.__unsStarted = true; // tells the safety net in index.html that the app is running
  // The buttons work at once: a click that comes before the data has loaded waits for it instead of being lost (slow networks).
  let dataLoaded; const dataReady = new Promise((r) => { dataLoaded = r; });
  $("file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $("fileName").textContent = f.name; $("fileName").removeAttribute("data-i18n");
    const text = await f.text(); await dataReady; start(text);
  });
  $("sample").addEventListener("click", async () => {
    $("sample").disabled = true;
    try { await dataReady; start(await (await fetch(lang === "zh" ? "sample_bookmarks.zh.html" : "sample_bookmarks.html")).text()); }
    finally { $("sample").disabled = false; }
  });
  history.replaceState({ step: 1 }, "", location.pathname + location.search);
  addEventListener("popstate", onBack);
  document.addEventListener("click", (e) => { const a = e.target.closest("a.pl-map"); if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openMap(a); } });
  $("mapBack").addEventListener("click", () => closeMap(false));
  $("mapPanel").addEventListener("click", (e) => { if (e.target === $("mapPanel")) closeMap(false); });
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeMap(false); });
  // Home: back to the top of the page, keeping everything loaded
  $("homeBtn").addEventListener("click", () => { setStep(state.total ? 3 : 1); window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" }); });
  addEventListener("scroll", () => $("homeBtn").classList.toggle("hide", scrollY < 500), { passive: true });
  document.querySelectorAll(".bi[data-g]").forEach((el) => { el.innerHTML = glyph(el.dataset.g); });
  // all reference data at once, not one after another
  [i18n, state.kb, state.exp, state.cal, state.placeNames, cities] = await Promise.all([
    fetch("kb/i18n.json").then((r) => r.json()), loadKb(), loadExpansion(), loadCalendar(), loadPlaceNames(),
    fetch("kb/cities.json").then((r) => r.json()).then((j) => j.cities),
  ]);
  applyTheme(savedTheme() === "default" ? "default" : savedTheme());
  bindMenuKeys();
  applyStatic();
  $("lang").addEventListener("click", () => {
    lang = lang === "zh" ? "en" : "zh";
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* storage blocked: the choice lasts for this page only */ }
    applyStatic();
    if (state.total) { renderStats(false); renderNeeds(); renderIdeas(); renderExpand(); renderTaste(); updatePayload(); renderResults(); }
  });
  $("city").addEventListener("change", () => { renderExpand(); updatePayload(); });
  $("quality").addEventListener("change", updatePayload);
  $("go").addEventListener("click", go);
  document.addEventListener("click", (e) => { if (e.target.closest("#inviteBtn")) sendInvite(); }); // the button is re-created whenever results are drawn
  $("aiBtn").addEventListener("click", runAI);
  $("clearData").addEventListener("click", clearData);
  addEventListener("pagehide", saveSession); // remembers the scroll position too
  dataLoaded();
  const nav = performance.getEntriesByType("navigation")[0];
  if (nav && nav.type === "back_forward") restoreSession(); // came back from another page: put things back as they were
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("payload").textContent); $("copy").textContent = ui("copied"); setTimeout(() => { $("copy").textContent = ui("copy"); }, 1200); } catch (e) { /* clipboard may be blocked */ }
  });
}
init();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  // registered a few seconds after the page has loaded, so installing never competes with the page for the network
  addEventListener("load", () => setTimeout(() => { navigator.serviceWorker.register("sw.js").catch(() => { /* private mode or blocked: the app works without it */ }); }, 4000));
}
