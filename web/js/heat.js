// Projection for the taste heatmap card. Degrees of longitude are shorter than degrees of latitude by cos(latitude), so the cells are laid out
// in kilometres, not in raw degrees, and the picture keeps its true proportions. The frame is the bounding box of the cells that came back
// (plus the city centre, when Qloo gives one), not the whole city. Pure functions, tested in test/heat.test.mjs.
const KM_PER_DEG = 111.32;
export function project(cells, center, W = 640, MAXH = 440, PAD = 20) {
  const pts = center ? [...cells, center] : cells;
  const lat0 = Math.min(...pts.map((c) => c.lat)), lat1 = Math.max(...pts.map((c) => c.lat));
  const lon0 = Math.min(...pts.map((c) => c.lon)), lon1 = Math.max(...pts.map((c) => c.lon));
  const k = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
  const kmW = Math.max((lon1 - lon0) * KM_PER_DEG * k, 0.1), kmH = Math.max((lat1 - lat0) * KM_PER_DEG, 0.1);
  const scale = Math.min((W - 2 * PAD) / kmW, (MAXH - 2 * PAD) / kmH); // pixels per km, the same on both axes
  const H = Math.round(kmH * scale + 2 * PAD);
  const x = (lon) => PAD + (lon - lon0) * KM_PER_DEG * k * scale, y = (lat) => H - PAD - (lat - lat0) * KM_PER_DEG * scale;
  const nice = [0.5, 1, 2, 5, 10, 20, 50].filter((n) => n * scale <= (W - 2 * PAD) / 3).pop() || 0.5;
  return { W, H, x, y, scale, kmW, kmH, bar: { km: nice, px: nice * scale }, inside: (p) => !!p.loc && p.loc.lat >= lat0 && p.loc.lat <= lat1 && p.loc.lon >= lon0 && p.loc.lon <= lon1 };
}
