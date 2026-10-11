// Re-locks the design after a deliberate change. Usage: node tools/lock_design.mjs --approve "reason"
import { writeFileSync } from "node:fs";
import { designHashes } from "./design_hash.mjs";
const i = process.argv.indexOf("--approve");
if (i < 0 || !process.argv[i + 1]) { console.error('ERROR refusing to re-lock without --approve "reason" (the owner decides when the look changes)'); process.exit(1); }
const lock = { locked_on: new Date().toISOString().slice(0, 10), reason: process.argv[i + 1], files: designHashes() };
writeFileSync(new URL("../design.lock.json", import.meta.url), JSON.stringify(lock, null, 2) + "\n");
console.log("design locked:", Object.keys(lock.files).length, "files,", lock.reason);
