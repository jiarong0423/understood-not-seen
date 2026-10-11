"""Lists the place names the page would show in the wrong language, so the mapping table (kb/place_names.json) can be completed.
Asks the RUNNING local server (default http://127.0.0.1:8770) for Taipei results of the activities used by the two demo samples.
Usage: python3 -B tools/unmapped_names.py [city]
English page problem = a name with Chinese and no English form. Chinese page problem = a Latin name with no Chinese form (brands may stay Latin).
"""
import json, re, sys, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
city = sys.argv[1] if len(sys.argv) > 1 else "Taipei"
kb = {a["activity"]: a["tag_id"] for a in json.load(open(ROOT / "kb/activities.json")) if a.get("tag_id")}
demo = ["Badminton court","Pickleball court","Bowling alley","Swimming pool","Tennis court","Golf course","Noodle shop","Wine bar","Fine dining restaurant","Ramen restaurant","Art museum","Hotel","Ski resort","Concert hall","Pilates studio","Massage","Spa","Hot pot restaurant","Night market"]
table = json.load(open(ROOT / "kb/place_names.json", encoding="utf-8"))["names"]
cjk = re.compile(r"[一-鿿]")
def split(n):
    m = re.match(r"^([A-Za-z][A-Za-z0-9&'.\-+ ]*?)\s*(?:[（(]\s*[一-鿿][^）)]*[）)]|\s[一-鿿].*)$", n) or re.match(r"^[一-鿿][一-鿿0-9]*\s+[A-Za-z][A-Za-z0-9&'.\-+ ]*$", n)
    return bool(m)
need_en, need_zh = set(), set()
tags = [kb[a] for a in demo]
for i in range(0, len(tags), 6):
    req = urllib.request.Request("http://127.0.0.1:8770/api/recommend", data=json.dumps({"city": city, "tags": tags[i:i+6]}).encode(), headers={"content-type": "application/json"})
    for g in json.load(urllib.request.urlopen(req, timeout=120))["groups"]:
        for p in g["places"]:
            n = p["name"]; t = table.get(n, {})
            if split(n): continue
            if cjk.search(n) and not t.get("en"): need_en.add(n)
            if not cjk.search(n) and not t.get("zh"): need_zh.add(n)
print("NEED ENGLISH (Chinese-only names):", len(need_en)); print("\n".join(sorted(need_en)))
print("\nNEED CHINESE (Latin-only names; brands may stay Latin):", len(need_zh)); print("\n".join(sorted(need_zh)))
