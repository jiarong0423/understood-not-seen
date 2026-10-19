// The page and the server must agree on how many categories one lookup may carry: if the page allows more, the server
// refuses the lookup (400) and the visitor sees an error instead of places. Run: node --test test/limits.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("page tag limit equals the server tag limit", () => {
  const page = Number(read("../web/js/app.js").match(/const MAX_TAGS = (\d+);/)[1]);
  const server = Number(read("../server/server.mjs").match(/tags\.length > (\d+)/)[1]);
  assert.equal(page, server);
});
test("every lookup error has a message in both languages", () => {
  const ui = JSON.parse(read("../web/kb/i18n.json")).ui;
  for (const k of ["too_many", "err_request", "err_slow", "err_budget", "err_network", "err_server", "err_code", "offline"]) assert.ok(ui[k]?.en && ui[k]?.zh, k);
});
