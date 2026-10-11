// The look is final and locked. This fails if the stylesheet, the themes, the icon set or the app icons change without a deliberate re-lock:
//   node tools/lock_design.mjs --approve "why the look changes"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { designHashes } from "../tools/design_hash.mjs";

test("design lock: stylesheet, themes, icons and app icons are unchanged since the owner locked them", () => {
  const lock = JSON.parse(readFileSync(new URL("../design.lock.json", import.meta.url)));
  const now = designHashes();
  assert.deepEqual(Object.keys(now).sort(), Object.keys(lock.files).sort(), "a locked file was added or removed");
  const changed = Object.keys(now).filter((k) => now[k] !== lock.files[k]);
  assert.deepEqual(changed, [], "design changed since the lock of " + lock.locked_on + " (" + lock.reason + "); re-lock only on the owner's decision");
});
