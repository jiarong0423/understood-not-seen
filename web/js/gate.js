// Privacy gate. Runs in the visitor's browser. Same rules as filter_bookmarks.py (see rules.js).
// Fail-closed: adult, account, personal, private-host and sensitive-query items are removed before anything else.
import { ADULT, PERSONAL, SENS_Q, ALLOW, SHARED, ADULT_TLDS } from "./rules.js";

const adultRe = new RegExp(ADULT.join("|"), "i");
const personalRe = new RegExp(PERSONAL.join("|"), "i");
const sensQ = new Set(SENS_Q);
const allow = new Set(ALLOW);
const shared = new Set(SHARED);
const scope = (it) => (shared.has(it.host) ? it.pathkey : it.host); // taint scope: path group on shared sites, else the whole site
const IP = /^\d{1,3}(\.\d{1,3}){3}$/;
const norm = (s) => (s || "").normalize("NFKC").toLowerCase();

export function registrable(host) {
  const p = host.split(".");
  if (p.length >= 3 && ["co", "com", "org", "gov", "edu", "ne"].includes(p[p.length - 2]) && p[p.length - 1].length === 2)
    return p.slice(-3).join(".");
  return p.length >= 2 ? p.slice(-2).join(".") : host;
}

// Parse a Netscape bookmarks.html (Chrome, Firefox, Safari export) into [{url,title,folders}]
export function parseBookmarks(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const folderPath = (a) => {
    const out = [];
    for (let el = a.parentElement; el; el = el.parentElement) {
      if (el.tagName === "DL" && el.parentElement && el.parentElement.tagName === "DT") {
        const h = [...el.parentElement.children].find((c) => c.tagName === "H3");
        if (h) out.unshift(h.textContent.trim());
      }
    }
    return out;
  };
  return [...doc.querySelectorAll("a[href]")].map((a) => ({
    url: a.getAttribute("href") || "", title: (a.textContent || "").trim(), folders: folderPath(a),
    added: /^\d+$/.test(a.getAttribute("add_date") || "") ? Number(a.getAttribute("add_date")) * 1000 : 0, // when it was saved (ms), 0 if unknown
  }));
}

// Returns a reason string if the item must be removed, else null
export function classify(it) {
  let u;
  try { u = new URL(it.url); } catch { return "bad_url"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "non_web_scheme";
  const host = u.hostname.toLowerCase();
  it.host = registrable(host);
  it.fullhost = host;
  it.pathkey = host + "/" + (u.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || "");
  if (!host || !host.includes(".") || IP.test(host) || /\.(local|internal|lan)$/.test(host)) return "private_host";
  const blob = norm([host, u.pathname, it.title, it.folders.join(" ")].join(" "));
  if (ADULT_TLDS.some((t) => host.endsWith(t)) || adultRe.test(blob)) return "adult";
  if (personalRe.test(blob)) return "personal_or_account";
  for (const k of u.searchParams.keys()) if (sensQ.has(k.toLowerCase())) return "sensitive_query";
  return null;
}

// Full gate: item rules, then contagion (a flagged domain or an adult-heavy folder removes its neighbours)
export function runGate(items) {
  const reasons = items.map(classify);
  const badDomains = new Set(), badHosts = new Set();
  items.forEach((it, i) => {
    if (reasons[i] === "adult" && it.host && !allow.has(it.host)) badDomains.add(scope(it)); // adult: the whole site (path group on shared sites)
    if (reasons[i] === "personal_or_account" && it.pathkey && !allow.has(it.host)) badHosts.add(it.pathkey); // account: same host and first path segment only
  });
  const tot = new Map(), bad = new Map();
  items.forEach((it, i) => {
    const k = it.folders.length ? it.folders[it.folders.length - 1] : "";
    tot.set(k, (tot.get(k) || 0) + 1);
    if (reasons[i] === "adult") bad.set(k, (bad.get(k) || 0) + 1);
  });
  const badFolders = new Set([...tot].filter(([k, n]) => k && (bad.get(k) || 0) / n >= 0.15).map(([k]) => k));
  items.forEach((it, i) => {
    if (reasons[i]) return;
    const k = it.folders.length ? it.folders[it.folders.length - 1] : "";
    if (badDomains.has(scope(it)) || badHosts.has(it.pathkey)) reasons[i] = "domain_contagion";
    else if (k && badFolders.has(k)) reasons[i] = "folder_contagion";
  });
  const counts = {};
  reasons.forEach((r) => { if (r) counts[r] = (counts[r] || 0) + 1; });
  return { kept: items.filter((_, i) => !reasons[i]), counts, total: items.length };
}
