// The heatmap picture keeps true proportions (kilometres, not raw degrees) and fits the cells that came back. Run: node --test test/heat.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { project } from "../web/js/heat.js";

test("longitude is scaled by cos(latitude): at 60 degrees north a square of degrees is about twice as tall as wide", () => {
  const cells = [{ lat: 60, lon: 10 }, { lat: 60.1, lon: 10.1 }];
  const g = project(cells, null);
  const w = g.x(10.1) - g.x(10), h = g.y(60) - g.y(60.1);
  assert.ok(Math.abs(h / w - 2) < 0.02, `height/width ${h / w}`);
  const eq = project([{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0.1 }], null); // at the equator the degrees are equal
  assert.ok(Math.abs((eq.y(0) - eq.y(0.1)) / (eq.x(0.1) - eq.x(0)) - 1) < 0.02);
});
test("the frame fits the cells and the centre, same pixels per km on both axes, with a scale bar that matches", () => {
  const cells = [{ lat: 25.0, lon: 121.45 }, { lat: 25.1, lon: 121.6 }], center = { lat: 25.05, lon: 121.52 };
  const g = project(cells, center);
  for (const c of [...cells, center]) { assert.ok(g.x(c.lon) >= 0 && g.x(c.lon) <= g.W); assert.ok(g.y(c.lat) >= 0 && g.y(c.lat) <= g.H); }
  const kmPerPx = 1 / g.scale, dx = (g.x(121.6) - g.x(121.45)) * kmPerPx, dy = (g.y(25.0) - g.y(25.1)) * kmPerPx;
  assert.ok(Math.abs(dx - 0.15 * 111.32 * Math.cos(25.05 * Math.PI / 180)) < 0.05);
  assert.ok(Math.abs(dy - 0.1 * 111.32) < 0.05);
  assert.ok(Math.abs(g.bar.px - g.bar.km * g.scale) < 1e-9 && g.bar.km > 0);
  assert.equal(g.inside({ loc: { lat: 25.05, lon: 121.5 } }), true);
  assert.equal(g.inside({ loc: { lat: 26, lon: 121.5 } }), false, "a place outside the frame is not drawn");
  assert.equal(g.inside({ loc: null }), false);
});
test("one cell alone does not divide by zero", () => {
  const g = project([{ lat: 25, lon: 121 }], null);
  assert.ok(Number.isFinite(g.x(121)) && Number.isFinite(g.y(25)) && g.H > 0);
});
