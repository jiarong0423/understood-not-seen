// Optional taste signals. A name the visitor saved (a cafe, a shop, a studio) can make Qloo rank places by taste instead of by category only.
// Names are proposed from the titles of kept bookmarks that led to a ticked idea. Nothing is selected by default, and a name leaves the
// device only if the visitor ticks it (it then appears in the "everything that leaves your device" box).
import { hitItems } from "./combine.js";

export const MAX_TASTE = 5;
const SPLIT = /\s*[|｜\-–—:：·•_]\s+|\s+[-–—]\s*|[|｜:：·•]/;
const GENERIC = /^(home|index|menu|about|contact|blog|news|login|shop|store|official|最新|首頁|首页|官網|官网|關於我們|聯絡我們)$/i;
const TOPIC_WORDS = /教學|教学|推薦|推荐|攻略|地圖|地图|入門|入门|指南|懶人包|心得|比較|比较|評價|评价|課程|课程|排行|戰術|战术|技巧|規則|规则|介紹|介绍/;

// First title segment, if it looks like a name (2-30 characters, not a URL, not only digits, not a generic page word)
export function nameFromTitle(title) {
  if (/^\s*(https?:|www\.)/i.test(title || "")) return null;
  const seg = (title || "").split(SPLIT).map((x) => x.trim()).find(Boolean) || "";
  if (seg.length < 2 || seg.length > 30) return null;
  if (TOPIC_WORDS.test(seg)) return null; // a topic or a how-to, not the name of a place
  if (/^\d+$/.test(seg) || /https?:|www\.|\.(com|net|org|tw|io)\b|@/i.test(seg) || GENERIC.test(seg)) return null;
  if (!/[^\x00-\x7f]/.test(seg) && /\s/.test(seg)) { // plain English with spaces: a name has capitalised words, a phrase does not
    const words = seg.split(/\s+/);
    if (words.length > 4 || words.some((w) => !/^([A-Z0-9&]|(of|and|the|de|la|le)$)/.test(w))) return null;
  }
  return seg;
}

// ideas: ranked ideas currently ticked; returns [{name, activity}] without duplicates, at most `limit`
export function candidateNames(items, ideas, kb, limit = 12) {
  const out = [], seen = new Set();
  for (const idea of ideas.filter((x) => x.on)) {
    const a = kb.find((k) => k.activity === idea.activity);
    if (!a) continue;
    for (const it of hitItems(items, a)) {
      const n = nameFromTitle(it.title), key = n && n.toLowerCase();
      if (!n || seen.has(key)) continue;
      seen.add(key); out.push({ name: n, activity: idea.activity });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
