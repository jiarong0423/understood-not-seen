// The look of the page is "locked": a hash of the stylesheet, the 14 themes, the icon set and the app icons.
// Shared by the lock tool and the test, so both hash exactly the same bytes.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WEB = join(fileURLToPath(new URL(".", import.meta.url)), "..", "web");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

export function designHashes() {
  const html = readFileSync(join(WEB, "index.html"), "utf8");
  const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
  const out = { "index.html <style>": sha(css), "js/themes.js": sha(readFileSync(join(WEB, "js/themes.js"))), "js/icons.js": sha(readFileSync(join(WEB, "js/icons.js"))) };
  for (const f of readdirSync(join(WEB, "icons")).sort()) out["icons/" + f] = sha(readFileSync(join(WEB, "icons", f)));
  return out;
}
