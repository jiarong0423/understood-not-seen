// Taiwan holidays and widely celebrated international days (kb/calendar.json). Used to time the invitation, never to guess anything about the visitor.
export async function loadCalendar() { return (await fetch("kb/calendar.json")).json(); }

const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The soonest entry that has not ended, starting within `window` days. Taiwan entries only for Taiwan cities.
// Returns {entry, days} where days is 0 when it is on now, or null.
export function upcoming(cal, todayIso, city, window = 45) {
  const tw = !cal.non_tw_cities.includes(city), t = day(todayIso);
  const rows = cal.entries
    .filter((e) => (tw || e.region !== "TW") && day(e.end) >= t)
    .map((e) => ({ entry: e, days: Math.max(0, Math.round((day(e.start) - t) / 86400000)) }))
    .filter((r) => r.days <= window)
    .sort((a, b) => a.days - b.days || (a.entry.kind === "holiday" ? -1 : 1));
  return rows[0] || null;
}

// Weeks since 1970: a seed that changes once a week, so a visitor who comes back next week sees different picks (no randomness, same all week).
export const weekSeed = (todayIso) => Math.floor((day(todayIso) / 86400000 + 3) / 7); // 1970-01-01 was a Thursday, +3 makes the week start on Monday
export const rotate = (arr, n) => (arr.length ? arr.map((_, i) => arr[(i + (n % arr.length + arr.length)) % arr.length]) : arr);
