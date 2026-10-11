"""Stage: architecture-guided SOFT labels, then COMBINE into activity candidates.

The local model is NOT a gatekeeper here. It labels each bookmark that already passed the hard privacy gate
(filter_bookmarks.run_filter: adult, account, personal, private hosts are gone) with soft signals:
  topic, needs (what the page serves in daily life), generic phrases, risk.
Items with risk != none stay in a LOCAL-ONLY lane (counted, never used for recommendations).
Everything else is combined: need weights -> activities in kb/activities.json -> Qloo place tag ids.
No person type is assigned. An optional --path 1|2 lets the visitor CHOOSE a stress-relief path; it is never inferred.

Usage: python3 -B build_signals.py data_private/bookmarks_raw.html [--path 1|2]
Output: data_private/activity_candidates.json and data_private/payload_preview_tags.md (nothing is sent).
"""
import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import requests

from filter_bookmarks import LLM_MODEL, LLM_URL, Parser, clean_title, run_filter

HERE = Path(__file__).parent
PRIV = HERE / "data_private"
TOPICS = ["finance", "investing", "tech_dev", "ai", "news", "food", "travel", "music", "film_tv", "book", "game",
          "fashion", "design", "art", "sports", "shopping", "education", "other"]
NEEDS = ["social", "stress_relief", "business_talk", "skill_display", "physical_repair", "mental_comfort",
         "quiet_solo", "culture", "status_display", "learning", "planning", "entertainment"]
WORK_TOPICS = {"finance", "investing", "tech_dev", "ai", "news", "education"}
RISKS = ["none", "adult", "health", "political", "religious", "orientation", "dating", "private"]

GUIDE = (
    "You are stage 2 of a privacy funnel. You turn ONE browser bookmark into SOFT signals. "
    "You never decide whether to keep or drop it. Reply with ONE line of JSON only:\n"
    '{"topic":"<' + "|".join(TOPICS) + '>","needs":["<0 to 3 of: ' + "|".join(NEEDS) + '>"],'
    '"phrases":["<=2 short generic lowercase English interest phrases"],"risk":"<' + "|".join(RISKS) + '>"}\n'
    "needs describe the ACTIVITY or venue the page is about, never the reader's job or the news. An article, news item or analysis is learning. Examples of the idea: a badminton court page serves "
    "social and stress_relief; a golf page serves business_talk; a bowling page serves skill_display; a massage page serves "
    "physical_repair; a meditation page serves mental_comfort; a tutorial serves learning; an itinerary serves planning; "
    "a music video serves entertainment. Use an empty list when none fits.\n"
    "phrases are generic interests only, never a name, account, address or anything identifying.\n"
    "risk is none for ordinary public topics (finance, tech, AI, sports, food, travel, shopping, entertainment). "
    "Use another value only if the page clearly is adult, medical, political, religious, about orientation, dating, or private."
)


def label(title, domain):
    body = {"model": LLM_MODEL, "temperature": 0, "max_tokens": 140, "reasoning_effort": "none",
            "messages": [{"role": "system", "content": GUIDE},
                         {"role": "user", "content": f"title: {title[:120]}\ndomain: {domain}"}]}
    try:
        r = requests.post(LLM_URL, json=body, timeout=90)
        text = r.json()["choices"][0]["message"]["content"] or ""
        d = json.loads(re.search(r"\{.*\}", text, re.S).group(0))
        topic, risk = d.get("topic"), d.get("risk", "none")
        needs = [n for n in d.get("needs", []) if n in NEEDS][:3]
        if topic in WORK_TOPICS:  # structure rule: reading about work topics is learning or planning, not a social activity
            needs = [n for n in needs if n in ("learning", "planning")] or (["learning"] if topic != "news" else [])
        ph = [re.sub(r"[^a-z0-9 \-&']", "", str(p).lower()).strip()[:32] for p in (d.get("phrases") or [])[:2]]
        if topic not in TOPICS or risk not in RISKS:
            return None
        return {"topic": topic, "needs": needs, "phrases": [p for p in ph if p], "risk": risk}
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("bookmarks")
    ap.add_argument("--path", choices=["1", "2"], default=None)
    a = ap.parse_args()
    p = Parser(); p.feed(Path(a.bookmarks).read_text(encoding="utf-8", errors="replace"))
    gate_total = len(p.items)
    cands = run_filter(p.items)  # hard gate result
    cache_f = PRIV / "signals_cache.json"
    cache = json.loads(cache_f.read_text()) if cache_f.exists() else {}
    asked = 0
    keys = []
    for it in cands:
        k = hashlib.sha1((clean_title(it.title) + "|" + it.host).encode()).hexdigest()
        if k not in cache:
            asked += 1
            cache[k] = label(clean_title(it.title), it.host)
        keys.append(k)
    cache_f.write_text(json.dumps(cache, ensure_ascii=False)); cache_f.chmod(0o600)

    labels = [cache[k] for k in keys]
    unusable = sum(1 for l in labels if l is None)
    soft = [l for l in labels if l]
    local_only = [l for l in soft if l["risk"] != "none"]
    use = [l for l in soft if l["risk"] == "none"]
    topics, needs, combos = Counter(), Counter(), Counter()
    for l in use:
        topics[l["topic"]] += 1
        w = 1.0 / max(1, len(l["needs"]))
        for n in l["needs"]:
            needs[n] += w
            combos[(l["topic"], n)] += w
    kb = json.loads((HERE / "kb" / "activities.json").read_text())
    phr = " ".join(ph for l in use for ph in l["phrases"])
    cand_rows = []
    for act in kb:
        if not act["tag_id"]:
            continue
        score = sum(needs.get(f, 0) for f in act["functions"])
        key = act["activity"].lower().split()[0]
        direct = len(re.findall(r"\b" + re.escape(key), phr))
        cand_rows.append({"activity": act["activity"], "tag_id": act["tag_id"], "functions": act["functions"],
                          "need_score": round(score, 2), "direct_mentions": direct, "source": "bookmark signals"})
    if a.path:
        path_funcs = {"1": {"physical_repair"}, "2": {"mental_comfort"}}[a.path]
        for r in cand_rows:
            if set(r["functions"]) & path_funcs:
                r["source"] = f"bookmark signals + visitor-chosen path {a.path}"
                r["need_score"] += 5  # explicit visitor choice outweighs weak signals
    cand_rows.sort(key=lambda r: (-(r["need_score"] + 2 * r["direct_mentions"]), r["activity"]))
    (PRIV / "activity_candidates.json").write_text(json.dumps(cand_rows, ensure_ascii=False, indent=1))
    prev = ["# Preview: what WOULD be sent to Qloo (nothing has been sent)", "",
            "Only public Qloo tag ids and a city. No bookmarks, titles, URLs or personal text.", "",
            "| activity | Qloo tag id | functions | score | source |", "|---|---|---|---|---|"]
    prev += [f"| {r['activity']} | {r['tag_id']} | {', '.join(r['functions'])} | {round(r['need_score'] + 2 * r['direct_mentions'], 2)} | {r['source']} |"
             for r in cand_rows if r["need_score"] + 2 * r["direct_mentions"] > 0]
    (PRIV / "payload_preview_tags.md").write_text("\n".join(prev) + "\n")
    for f in ("activity_candidates.json", "payload_preview_tags.md"):
        (PRIV / f).chmod(0o600)

    print(f"links: {gate_total} | after hard gate: {len(cands)} | asked model: {asked} | unusable: {unusable}")
    print(f"soft-labelled: {len(soft)} | local-only lane (risk != none): {len(local_only)} | used: {len(use)}")
    print("topics:", dict(topics.most_common()))
    print("needs (weighted):", {k: round(v, 1) for k, v in needs.most_common()})
    print("top topic x need combos:", [(f"{t}+{n}", round(c, 1)) for (t, n), c in combos.most_common(6)])
    top = [r for r in cand_rows if r["need_score"] + 2 * r["direct_mentions"] > 0]
    print(f"activity candidates with any score: {len(top)} of {len(cand_rows)}")
    for r in top[:6]:
        print(f"   {r['activity']:18} score={round(r['need_score'] + 2 * r['direct_mentions'], 2):5} via {','.join(r['functions'])}")


if __name__ == "__main__":
    main()
