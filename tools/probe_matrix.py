"""Measures, for each (city, activity tag), how many places Qloo returns. Reads QLOO_API_KEY from .env, never prints it.
Usage: python3 -B tools/probe_matrix.py [Activity name ...]   (no names = every activity). Writes cache/matrix_<timestamp>.json
"""
import json, sys, time
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://hackathon.api.qloo.com"
key = next(l.split("=", 1)[1].strip().strip("\"'") for l in (ROOT / ".env").read_text().splitlines() if l.startswith("QLOO_API_KEY="))
kb = [a for a in json.load(open(ROOT / "kb/activities.json")) if a.get("tag_id")]
cities = [c["en"] for c in json.load(open(ROOT / "kb/cities.json"))["cities"]]
want = set(sys.argv[1:])
acts = [a for a in kb if not want or a["activity"] in want]
out, errors = {}, 0
for a in acts:
    row = {}
    for c in cities:
        r = requests.get(BASE + "/v2/insights", headers={"X-Api-Key": key}, timeout=30, params={
            "filter.type": "urn:entity:place", "filter.tags": a["tag_id"], "filter.location.query": c, "take": 10})
        if r.status_code == 200:
            row[c] = len(r.json().get("results", {}).get("entities", []))
        else:
            row[c] = f"HTTP {r.status_code}"; errors += 1
        time.sleep(0.25)
    out[a["activity"]] = row
    print(a["activity"], "->", sum(v for v in row.values() if isinstance(v, int)), "places over", len(cities), "cities", flush=True)
fn = ROOT / "cache" / f"matrix_{int(time.time())}.json"
fn.write_text(json.dumps(out, ensure_ascii=False, indent=1))
empty = [(k, c) for k, r in out.items() for c, v in r.items() if v == 0]
print("cells:", sum(len(r) for r in out.values()), "| empty:", len(empty), "| errors:", errors, "| saved", fn.name)
