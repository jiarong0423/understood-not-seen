import { glyph } from "./icons.js";
// Collapsible style switcher (top right). 14 original personality styles, all driven by CSS variables.
// Only the look changes. The choice is remembered in this browser (localStorage, optional).
// No brand-named styles are bundled in the public build on purpose.
const T = (id, en, zh, bg, surface, ink, muted, accent, on, line, r, bw, shadow, fd, fb) => ({ id, en, zh, v: { bg, surface, ink, muted, accent, "accent-ink": on, line, r, bw, shadow, "font-display": fd, "font-body": fb } });
const SERIF = "'Noto Serif TC','Songti TC',Georgia,serif", SANS = "'Noto Sans TC','PingFang TC',system-ui,sans-serif", MONO = "ui-monospace,Menlo,monospace";
export const THEMES = [
  T("news", "Newspaper", "報紙編輯", "#f1ede3", "#e6e0d2", "#111111", "#5a554c", "#c8102e", "#ffffff", "#111111", "0px", "1px", "none", SERIF, SERIF),
  T("swiss", "Swiss grid", "瑞士網格", "#ffffff", "#f3f3f3", "#000000", "#444444", "#ff3b00", "#ffffff", "#000000", "0px", "2px", "none", SANS, SANS),
  T("washi", "Washi paper", "日系和紙", "#f3efe6", "#fbf9f4", "#3b3530", "#7a726a", "#8a3b23", "#f3efe6", "#d8d0c2", "4px", "1px", "none", SERIF, SERIF),
  T("riso", "Risograph", "孔版印刷", "#f4eedf", "#fffaf0", "#1d3fbb", "#4662c9", "#ff48b0", "#1d3fbb", "#1d3fbb", "4px", "2px", "4px 4px 0 #1d3fbb", MONO, MONO),
  T("sign", "Taiwan signboard", "台式老招牌", "#1f4636", "#173628", "#f4e9cf", "#e3c27a", "#c0392b", "#f4e9cf", "#e3c27a", "2px", "2px", "none", SERIF, SERIF),
  T("kid", "Playful", "手感童趣", "#fff6e5", "#ffffff", "#2b2118", "#6e5a49", "#ff7a59", "#ffffff", "#2b2118", "18px", "2.5px", "0 4px 0 #2b2118", SANS, SANS),
  T("bauhaus", "Bauhaus", "包浩斯", "#f2ece0", "#ffffff", "#1a1a1a", "#555555", "#e63b2e", "#ffffff", "#1a1a1a", "0px", "3px", "4px 4px 0 #1f4fa8", SANS, SANS),
  T("seventies", "Seventies", "70 年代復古", "#f3e3c3", "#fbf1dc", "#3d2314", "#7a4e32", "#d9682b", "#fbf1dc", "#3d2314", "22px", "2px", "none", SERIF, SERIF),
  T("crt", "Terminal CRT", "終端機 CRT", "#0b0f0a", "#111910", "#39ff6a", "#1f9c42", "#39ff6a", "#0b0f0a", "#39ff6a", "0px", "1px", "0 0 12px rgba(57,255,106,.22)", MONO, MONO),
  T("mag", "Fashion magazine", "時尚雜誌", "#ffffff", "#f7f4f0", "#000000", "#6e5a4c", "#000000", "#ffffff", "#000000", "0px", "1px", "none", SERIF, SANS),
  T("brut", "Neo-brutalism", "新粗獷", "#ffe14d", "#ffffff", "#000000", "#222222", "#ff5ca8", "#000000", "#000000", "0px", "3.5px", "6px 6px 0 #000000", SANS, SANS),
  T("earth", "Earth tones", "自然大地", "#eee8dc", "#f6f2ea", "#2f3a2c", "#5b6656", "#c97b5a", "#ffffff", "#cfc6b4", "16px", "1px", "none", SERIF, SANS),
  T("blueprint", "Blueprint", "工程藍圖", "#1b3f8b", "#153373", "#e8f0ff", "#9cb6e8", "#e8f0ff", "#1b3f8b", "#e8f0ff", "0px", "1px", "none", MONO, MONO),
  T("y2k", "Y2K", "千禧 Y2K", "#f3e8ff", "#ffffff", "#1d1b4b", "#544f8c", "#ff4fd8", "#ffffff", "#1d1b4b", "24px", "1.5px", "0 4px 14px rgba(255,79,216,.25)", SANS, SANS),
];
const KEY = "uns-theme";
const root = document.documentElement.style;
const safe = (f) => { try { return f(); } catch { return null; } };

export function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id);
  for (const k of ["bg", "surface", "ink", "muted", "accent", "accent-ink", "line", "r", "bw", "shadow", "font-display", "font-body"]) root.removeProperty("--" + k);
  document.documentElement.dataset.theme = t ? t.id : "default";
  if (t) for (const [k, v] of Object.entries(t.v)) root.setProperty("--" + k, v);
  safe(() => localStorage.setItem(KEY, t ? t.id : "default"));
}
export const savedTheme = () => safe(() => localStorage.getItem(KEY)) || "default";

// Builds the collapsible menu into #themeMenu. `lang` is "en" or "zh", `defaultLabel` the label for the default style.
export function renderThemeMenu(lang, defaultLabel, onPick) {
  const el = document.getElementById("themeMenu");
  const cur = savedTheme();
  const name = (t) => (lang === "zh" ? t.zh : t.en);
  const label = cur === "default" ? defaultLabel : name(THEMES.find((t) => t.id === cur) || THEMES[0]);
  const open = el.hasAttribute("open");
  el.innerHTML = `<summary class="pill">${glyph("palette", "ic xs")} ${label} ▾</summary><div class="panel" role="menu">
    <button class="theme ${cur === "default" ? "on" : ""}" data-id="default" role="menuitem"><i class="sw" style="background:linear-gradient(135deg,#4338ca,#15803d)"></i>${defaultLabel}</button>
    ${THEMES.map((t) => `<button class="theme ${cur === t.id ? "on" : ""}" data-id="${t.id}" role="menuitem"><i class="sw" style="background:${t.v.accent};border-color:${t.v.ink}"></i>${name(t)}</button>`).join("")}</div>`;
  if (open) el.setAttribute("open", "");
  el.querySelectorAll(".theme").forEach((b) => b.addEventListener("click", () => { applyTheme(b.dataset.id); el.removeAttribute("open"); onPick(); }));
}
export function bindMenuKeys() {
  const el = document.getElementById("themeMenu");
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); el.toggleAttribute("open"); }
    if (e.key === "Escape") el.removeAttribute("open");
  });
  document.addEventListener("click", (e) => { if (!el.contains(e.target)) el.removeAttribute("open"); });
}
