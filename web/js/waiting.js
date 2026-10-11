// "Saved, not yet done": bookmarks carry the date they were saved (ADD_DATE). For the ticked ideas, find the oldest saved bookmark that is at
// least `minDays` old. This only knows when something was saved, never whether you went, so the wording says "saved" and nothing more.
// Computed in this tab; nothing about it is sent anywhere.
import { hitItems } from "./combine.js";

export function waiting(items, ideas, kb, now = Date.now(), minDays = 90) {
  const out = [];
  for (const idea of ideas.filter((x) => x.on)) {
    const a = kb.find((k) => k.activity === idea.activity);
    if (!a) continue;
    const old = hitItems(items, a).filter((it) => it.added && now - it.added >= minDays * 86400000).sort((x, y) => x.added - y.added)[0];
    if (old) out.push({ activity: a.activity, months: Math.floor((now - old.added) / (30.44 * 86400000)), title: old.title.slice(0, 40) });
  }
  return out.sort((x, y) => y.months - x.months).slice(0, 3);
}
