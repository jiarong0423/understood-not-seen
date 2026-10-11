// Combine step: kept bookmarks + the activity knowledge base (+ optional visitor-chosen needs) -> ranked activities.
// Needs come from the knowledge base (the activity's functions), not from a guess about the person.
// Reading about work topics is never turned into a social or leisure need.

export const NEED_LABELS = {
  social: "Social", stress_relief: "Stress relief", business_talk: "Business talk", skill_display: "Show a skill",
  physical_repair: "Physical recovery", mental_comfort: "Mental comfort", quiet_solo: "Quiet time",
  culture: "Culture", status_display: "Showcase", entertainment: "Entertainment",
  shopping: "Shopping and finds", outdoors: "Outdoors", learning: "Learn something",
};

export async function loadKb() {
  const r = await fetch("kb/activities.json");
  return (await r.json()).filter((a) => a.tag_id);
}

// chosen: array of need keys the visitor picked (may be empty)
// English keywords must match whole words (plural allowed) so "spa" does not match Spain or space.
// Chinese keywords match as substrings because Chinese is written without spaces.
const reCache = new Map();
function keywordRegex(keywords) {
  const key = keywords.join("|");
  if (reCache.has(key)) return reCache.get(key);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean).map((k) =>
    /[\u4e00-\u9fff]/.test(k) ? esc(k) : `(?<![a-z])${esc(k)}(?:s|es)?(?![a-z])`);
  const re = new RegExp(parts.join("|") || "$^");
  reCache.set(key, re);
  return re;
}

// The bookmarks that point at one activity (same test as the ranking)
export function hitItems(items, a) {
  const re = keywordRegex(a.keywords || []);
  return items.filter((it) => (it.hints || []).includes(a.activity) || re.test((it.title + " " + (it.host || "")).toLowerCase()));
}

export function rankActivities(items, kb, chosen = []) {
  const rows = kb.filter((a) => !a.fallback_only).map((a) => {
    const re = keywordRegex(a.keywords || []);
    const hits = items.filter((it) => (it.hints || []).includes(a.activity) || re.test((it.title + " " + (it.host || "")).toLowerCase()));
    const overlap = a.functions.filter((f) => chosen.includes(f));
    const score = hits.length + 3 * overlap.length;
    return { activity: a.activity, tag_id: a.tag_id, functions: a.functions, hits: hits.length, chosen: overlap, score };
  });
  return rows.filter((r) => r.score > 0).sort((x, y) => y.score - x.score || x.activity.localeCompare(y.activity));
}

// Items that no activity keyword matches (candidates for the optional on-device AI step)
export function unmatched(items, kb) {
  const res = kb.filter((a) => !a.fallback_only).map((a) => keywordRegex(a.keywords || []));
  return items.filter((it) => {
    const text = (it.title + " " + (it.host || "")).toLowerCase();
    return !res.some((re) => re.test(text));
  });
}
