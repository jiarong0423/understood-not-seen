// Beyond the bookmarks: four ways to suggest other activities from the ticked ideas (hand-made tables in kb/expansion.json).
//   deeper   same world, another medium or a more serious version
//   same     serves a need the source also serves, in a different field (computed from the activity needs)
//   with     goes with the same occasion
//   balance  serves a need that counterweights the source's need
// It describes activities, never the person. Suggestions are never ticked by default.
export const PATHS = ["deeper", "same", "with", "balance"];

export async function loadExpansion() { return (await fetch("kb/expansion.json")).json(); }

// sources: ranked ideas the visitor has ticked; returns [{activity, tag_id, path, from}] (at most `limit`, spread over the four paths)
export function expand(sources, kb, exp, limit = 6) {
  const by = Object.fromEntries(kb.map((a) => [a.activity, a]));
  const taken = new Set(sources.map((s) => s.activity)); // anything already an idea is not a suggestion
  const lists = { deeper: [], same: [], with: [], balance: [] };
  const push = (path, name, from) => { if (by[name] && !by[name].fallback_only) lists[path].push({ activity: name, tag_id: by[name].tag_id, path, from }); };
  for (const s of sources) {
    const a = by[s.activity]; if (!a) continue;
    const family = new Set(Object.values(exp.families).filter((f) => f.includes(a.activity)).flat());
    for (const n of family) if (n !== a.activity) push("deeper", n, a.activity);
    const shared = kb.filter((b) => b.activity !== a.activity && !b.fallback_only && !family.has(b.activity) && b.functions.some((f) => a.functions.includes(f)))
      .map((b) => ({ b, n: b.functions.filter((f) => a.functions.includes(f)).length }))
      .sort((x, y) => y.n - x.n || x.b.activity.localeCompare(y.b.activity));
    for (const { b } of shared) push("same", b.activity, a.activity);
    for (const n of exp.goes_with[a.activity] || []) push("with", n, a.activity);
    const want = new Set(a.functions.flatMap((f) => exp.balance[f] || []));
    for (const b of kb) if (b.activity !== a.activity && !b.fallback_only && b.functions.some((f) => want.has(f)) && !b.functions.some((f) => a.functions.includes(f))) push("balance", b.activity, a.activity);
  }
  // round-robin over the four paths so one path cannot fill the list; each source gets its turn first
  const out = [], idx = { deeper: 0, same: 0, with: 0, balance: 0 }, perSource = new Set();
  for (let guard = 0; out.length < limit && guard < 200; guard++) {
    let added = false;
    for (const p of PATHS) {
      while (idx[p] < lists[p].length) {
        const c = lists[p][idx[p]++];
        const key = p + "|" + c.from;
        if (taken.has(c.activity) || perSource.has(key)) continue;
        taken.add(c.activity); perSource.add(key); out.push(c); added = true; break;
      }
      if (out.length >= limit) break;
    }
    if (!added && PATHS.every((p) => idx[p] >= lists[p].length)) break;
    if (!added) perSource.clear(); // every source has had one per path; allow a second round
  }
  return out;
}
