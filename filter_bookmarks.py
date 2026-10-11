"""Local-only bookmark privacy filter. Fail-closed.

Reads a Netscape bookmarks.html, drops adult / personal / account / private
items, and keeps ONLY items from an allowlist of public-content domains.
Dropped items are never written anywhere: only per-reason counts are kept.

Usage:
    python3 -B filter_bookmarks.py selftest
    python3 -B filter_bookmarks.py run data_private/bookmarks_raw.html
Output (kept items only): data_private/clean_candidates.json
"""
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).parent
OUT = HERE / "data_private" / "clean_candidates.json"

# ---- rules (code only, safe to publish) -------------------------------------
ADULT_TLDS = (".xxx", ".adult", ".porn", ".sex", ".sexy")
ADULT_PATTERNS = [
    r"porn", r"xxx", r"xvideos", r"xnxx", r"xhamster", r"redtube", r"youporn",
    r"hentai", r"nsfw", r"onlyfans", r"fansly", r"erotic", r"(?<![a-z])jav(?![a-z])", r"javdb",
    r"missav", r"jable", r"spankbang", r"eporner", r"tube8", r"hanime", r"nhentai",
    r"(?<![a-z])sex(?![a-z])", r"nude", r"naked", r"fetish", r"bdsm", r"(?<![a-z])milf(?![a-z])",
    r"camgirl", r"escort", r"r-?18(?![0-9])", r"18\+", r"gravure", r"uncensored",
    r"色情", r"成人", r"情色", r"無碼", r"无码", r"女優", r"女优", r"18禁", r"裏番",
    r"里番", r"做愛", r"做爱", r"性愛", r"性爱", r"約砲", r"约炮", r"援交", r"寫真",
    r"写真", r"福利姬", r"色色", r"自慰", r"淫", r"裸", r"エロ", r"アダルト", r"無修正",
    r"ポルノ", r"av女", r"av影", r"成年",
]
PERSONAL_PATTERNS = [
    r"bank", r"銀行", r"郵局", r"(證券|证券)(帳戶|账户|登入|登录|下單|下单|app|網路下單)", r"信用卡(帳單|账单|對帳|額度|额度|登入|登录|網銀)", r"creditcard", r"paypal",
    r"stripe", r"保險", r"保险", r"報稅", r"报税", r"發票", r"发票", r"invoice",
    r"醫院", r"医院", r"診所", r"诊所", r"病歷", r"病历", r"掛號", r"挂号", r"patient", r"(?<![a-z])portal",
    r"medical[ _-]?record", r"prescription", r"appointment", r"處方", r"用藥", r"藥局", r"藥品", r"藥物",
    r"health[ ._-]?(record|portal|account|login)", r"心理(諮商|治療|師|醫)", r"精神(科|疾病|醫|病)", r"depress",
    r"憂鬱", r"抑郁", r"貸款", r"贷款", r"(?<![a-z])loan", r"律師", r"律师", r"法院", r"訴訟",
    r"戶政", r"户政", r"健保", r"勞保", r"劳保", r"(?<![a-z])log-?in(?![a-z])", r"(?<![a-z])sign-?in(?![a-z])", r"(?<![a-z])sign-?up(?![a-z])",
    r"(?<![a-z])auth(?![a-z])", r"account", r"password", r"(忘記|忘记|重設|重置|變更|变更|修改|輸入|输入|管理|您的|你的)(密碼|密码)", r"登入", r"登录",
    r"會員", r"会员", r"oauth", r"(?<![a-z])sso(?![a-z])", r"webmail", r"mail\.", r"outlook", r"inbox",
    r"icloud", r"dropbox", r"docs\.google", r"drive\.google", r"notion\.", r"(?<!today\.)line\.me",
    r"telegram", r"discord", r"whatsapp", r"messenger", r"facebook", r"instagram",
    r"twitter", r"(?<![a-z])x\.com", r"threads\.net", r"linkedin", r"tinder",
    r"bumble", r"(?<![a-z])dating", r"交友", r"lgbt", r"(?<![a-z])gay(?![a-z])", r"同志",
    r"church", r"教會", r"教会", r"宗教", r"政治", r"選舉", r"选举", r"salary", r"薪",
    r"election", r"politic", r"candidate", r"campaign", r"senate", r"parliament",
    r"(?<![a-z])vote", r"voting", r"國會", r"立委", r"總統", r"总统", r"議員", r"政黨",
    r"resume", r"履歷", r"履历", r"(?<![a-z])admin", r"dashboard", r"(?<![a-z])console(?![a-z])", r"localhost",
]
SENSITIVE_QUERY_KEYS = {
    "token", "session", "sid", "uid", "key", "apikey", "api_key", "email", "phone",
    "user", "username", "password", "pwd", "code", "auth", "access_token", "id_token",
}
# Positive allowlist: only these public-content domains can be kept (fail-closed).
ALLOW_DOMAINS = {
    "youtube.com", "youtu.be", "spotify.com", "imdb.com", "wikipedia.org",
    "letterboxd.com", "goodreads.com", "bandcamp.com", "soundcloud.com",
    "music.apple.com", "tv.apple.com", "netflix.com", "tripadvisor.com", "yelp.com",
    "booking.com", "airbnb.com", "agoda.com", "klook.com", "kkday.com", "lonelyplanet.com",
    "rateyourmusic.com", "last.fm", "genius.com", "pitchfork.com", "boardgamegeek.com",
    "steampowered.com", "store.steampowered.com", "twitch.tv", "kickstarter.com",
    "eater.com", "michelin.com", "guide.michelin.com", "ifoodie.tw", "tabelog.com",
    "gurunavi.com", "retty.me", "cookpad.com", "allrecipes.com", "seriouseats.com",
    "mubi.com", "criterion.com", "themoviedb.org", "rottentomatoes.com", "bgm.tv",
    "anilist.co", "myanimelist.net", "pitchfork.com", "bandsintown.com", "songkick.com",
    "ra.co", "dice.fm", "eventbrite.com", "strava.com", "alltrails.com", "wikiloc.com",
    "monocle.com", "kinfolk.com", "dezeen.com", "archdaily.com", "designboom.com",
}

# Large shared sites: one flagged page must not taint the whole site, only its own path group.
SHARED_HOSTS = {"google.com", "bing.com", "duckduckgo.com", "yahoo.com", "baidu.com", "reddit.com", "medium.com",
                "blogspot.com", "wordpress.com", "line.me", "facebook.com", "x.com", "twitter.com", "vocus.cc", "substack.com"}

ADULT_RE = re.compile("|".join(ADULT_PATTERNS), re.I)
PERSONAL_RE = re.compile("|".join(PERSONAL_PATTERNS), re.I)
IP_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").casefold()


def registrable(host: str) -> str:
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in {"co", "com", "org", "gov", "edu", "ne"} and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


class Item:
    __slots__ = ("url", "title", "folders", "host", "fullhost", "pathkey", "reason", "added")

    def __init__(self, url, title, folders, added=0):
        self.url, self.title, self.folders = url, title, tuple(folders)
        self.host, self.fullhost, self.pathkey, self.reason, self.added = "", "", "", None, added


class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items, self.stack, self._pending, self._in_h3, self._in_a = [], [], None, False, None
        self._buf = ""
        self._added = 0

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t == "h3":
            self._in_h3, self._buf = True, ""
        elif t == "a":
            _a = dict((k.lower(), v) for k, v in attrs)
            self._in_a = _a.get("href", "")
            self._added = int(_a["add_date"]) if str(_a.get("add_date", "")).isdigit() else 0
            self._buf = ""
        elif t == "dl" and self._pending is not None:
            self.stack.append(self._pending)
            self._pending = None

    def handle_endtag(self, tag):
        t = tag.lower()
        if t == "h3":
            self._in_h3, self._pending = False, self._buf.strip()
        elif t == "a" and self._in_a is not None:
            self.items.append(Item(self._in_a, self._buf.strip(), self.stack, self._added))
            self._in_a = None
        elif t == "dl" and self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if self._in_h3 or self._in_a is not None:
            self._buf += data


def classify(it: Item) -> None:
    """Sets it.reason to a drop reason, or None if it passes the item-level rules."""
    try:
        sp = urlsplit(it.url)
    except ValueError:
        it.reason = "bad_url"
        return
    if sp.scheme not in ("http", "https"):
        it.reason = "non_web_scheme"
        return
    host = (sp.hostname or "").lower()
    it.host = registrable(host)
    it.fullhost = host
    it.pathkey = host + "/" + (sp.path.strip("/").split("/")[0] if sp.path.strip("/") else "")
    if not host or "." not in host or IP_RE.match(host) or host.endswith((".local", ".internal", ".lan")):
        it.reason = "private_host"
        return
    blob = norm(" ".join([host, sp.path, it.title, " ".join(it.folders)]))
    if host.endswith(ADULT_TLDS) or ADULT_RE.search(blob):
        it.reason = "adult"
        return
    if PERSONAL_RE.search(blob):
        it.reason = "personal_or_account"
        return
    qkeys = {kv.split("=")[0].lower() for kv in sp.query.split("&") if kv}
    if qkeys & SENSITIVE_QUERY_KEYS:
        it.reason = "sensitive_query"
        return
    if it.host not in ALLOW_DOMAINS and host not in ALLOW_DOMAINS:
        it.reason = "not_allowlisted"


def run_filter(items):
    for it in items:
        classify(it)
    # contagion: an adult/personal hit taints its whole domain (except big public
    # platforms in ALLOW_DOMAINS, where only the item and its folder are tainted)
    scope = lambda i: i.pathkey if i.host in SHARED_HOSTS else i.host  # taint scope: path group on shared sites, else the site
    bad_domains = {scope(i) for i in items if i.reason == "adult" and i.host and i.host not in ALLOW_DOMAINS}
    bad_hosts = {i.pathkey for i in items if i.reason == "personal_or_account" and i.pathkey and i.host not in ALLOW_DOMAINS}
    folder_tot, folder_bad = Counter(), Counter()
    for i in items:
        key = i.folders[-1] if i.folders else ""
        folder_tot[key] += 1
        if i.reason == "adult":  # folders are tainted by adult hits only; account pages taint just their domain
            folder_bad[key] += 1
    bad_folders = {k for k in folder_tot if k and folder_bad[k] / folder_tot[k] >= 0.15}
    pending = (None, "not_allowlisted")
    for i in items:
        if i.reason in pending and (scope(i) in bad_domains or i.pathkey in bad_hosts):
            i.reason = "domain_contagion"
        elif i.reason in pending and i.folders and i.folders[-1] in bad_folders:
            i.reason = "folder_contagion"
    return [i for i in items if i.reason in pending]


# ---- stage 2: local LLM (LM Studio, localhost only). Fail-closed. ------------
LLM_URL = "http://localhost:1234/v1/chat/completions"
LLM_MODEL = "nvidia-nemotron-3-nano-4b"
CATEGORIES = {"music", "film_tv", "book", "food", "travel", "game", "fashion", "design", "art", "tech", "news", "other"}
KEEP_CATS = {"music", "film_tv", "book", "food", "travel", "game", "fashion", "design", "art"}
LLM_SYSTEM = (
    "You label one browser bookmark. Reply with ONE line of JSON only, no other text:\n"
    '{"public_culture":true|false,"sensitive":true|false,"category":"music|film_tv|book|food|travel|game|fashion|design|art|tech|news|other"}\n'
    "sensitive=true if the page is adult or sexual, health or medical, a finance or other account, "
    "political, religious, about sexual orientation, dating, personal or private, a login or admin page, "
    "or if you are not sure.\n"
    "public_culture=true only if it is about a publicly known cultural thing: an artist, film, show, book, "
    "restaurant, place, brand, game, design work or event."
)


FAIL_TYPES = Counter()


def llm_label(title: str, domain: str):
    """Returns (public_culture, sensitive, category) or None on ANY problem (=> drop)."""
    import requests  # local import: selftest of rules needs no network

    body = {
        "model": LLM_MODEL,
        "temperature": 0,
        "max_tokens": 80,
        "reasoning_effort": "none",
        "messages": [
            {"role": "system", "content": LLM_SYSTEM},
            {"role": "user", "content": f"title: {title[:120]}\ndomain: {domain}"},
        ],
    }
    try:
        r = requests.post(LLM_URL, json=body, timeout=90)
        if r.status_code != 200:
            FAIL_TYPES[f"http_{r.status_code}"] += 1
            return None
        text = r.json()["choices"][0]["message"]["content"] or ""
        if not text.strip():
            FAIL_TYPES["empty_reply"] += 1
            return None
        m = re.search(r"\{.*?\}", text, re.S)
        if not m:
            FAIL_TYPES["no_json_in_reply(refusal_or_prose)"] += 1
            return None
        d = json.loads(m.group(0))
        pc, se, cat = d["public_culture"], d["sensitive"], d["category"]
        if not (isinstance(pc, bool) and isinstance(se, bool)):
            FAIL_TYPES[f"bad_bool:{type(pc).__name__},{type(se).__name__}"] += 1
            return None
        if cat not in CATEGORIES:
            FAIL_TYPES["bad_category:" + str(cat)[:24]] += 1
            return None
        return pc, se, cat
    except Exception as e:
        FAIL_TYPES[f"exception_{type(e).__name__}"] += 1
        return None


def llm_stage(cands):
    """Keep only items the local model calls public_culture AND not sensitive."""
    kept, why = [], Counter()
    for i in cands:
        res = llm_label(clean_title(i.title), i.host)
        if res is None:
            why["llm_unusable_or_refused"] += 1
            continue
        pc, se, cat = res
        if se:
            why["llm_sensitive"] += 1
        elif not pc:
            why["llm_not_public_culture"] += 1
        elif cat not in KEEP_CATS:
            why["llm_not_a_qloo_category"] += 1
        else:
            i.reason = None
            kept.append((i, cat))
    return kept, why


def clean_title(t: str) -> str:
    t = re.sub(r"\s*[\-|–—·:]\s*(YouTube|Wikipedia|IMDb|Spotify|Netflix|Letterboxd|Goodreads).*$", "", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip()


def selftest() -> None:
    cases = [
        ("https://www.youtube.com/watch?v=abc", "Radiohead - Live", [], None),
        ("https://en.wikipedia.org/wiki/Jazz", "Jazz - Wikipedia", [], None),
        ("https://www.pornhub.com/view_video", "x", [], "adult"),
        ("https://example.com/a", "free 無碼 stuff", [], "adult"),
        ("https://www.youtube.com/watch?v=1", "some r18 compilation", [], "adult"),
        ("https://www.youtube.com/watch?v=1", "ok title", ["成人"], "adult"),
        ("https://mybank.com/login", "Bank", [], "personal_or_account"),
        ("https://www.facebook.com/someone", "profile", [], "personal_or_account"),
        ("http://192.168.0.1/admin", "router", [], "private_host"),
        ("chrome://settings", "Settings", [], "non_web_scheme"),
        ("https://www.youtube.com/watch?v=1&token=zzz", "t", [], "sensitive_query"),
        ("https://random-blog.example.org/post", "A nice blog", [], "not_allowlisted"),
        ("https://www.sussex.ac.uk/", "Sussex Uni", [], "not_allowlisted"),
        ("https://www.youtube.com/watch?v=1", "Badminton doubles tactics", [], None),
        ("https://www.youtube.com/watch?v=2", "JavaScript tutorial for beginners", [], None),
        ("https://www.youtube.com/watch?v=3", "Milford Sound travel guide", [], None),
        ("https://www.eater.com/x", "Updating the menu at an association dinner", [], None),
        ("https://example.com/admin/panel", "Admin panel", [], "personal_or_account"),
        ("https://www.94itv.net/x", "Gunpowder Milkshake \u706b\u85e5\u5976\u6614\u7dda\u4e0a\u770b", [], "not_allowlisted"),
        ("https://today.line.me/tw/v2/article/x", "\u529f\u592b\u83dc recipe", [], "not_allowlisted"),
        ("https://blog.example.com/physio", "Physiotherapy Clinic: common badminton injuries", [], "not_allowlisted"),
        ("https://line.me/R/ti/p/abc", "Add me on LINE", [], "personal_or_account"),
        ("https://clinic.example.org/patient/login", "Clinic", [], "personal_or_account"),
        ("https://www.example.com/a", "\u8ca1\u5bcc\u5bc6\u78bc: how to think about compounding", [], "not_allowlisted"),
        ("https://www.example.com/b", "\u5fd8\u8a18\u5bc6\u78bc", [], "personal_or_account"),
        ("https://www.fsc.example.gov.tw/x", "Securities filings status lookup", [], "not_allowlisted"),
    ]
    ok = True
    for url, title, folders, want in cases:
        it = Item(url, title, folders)
        classify(it)
        good = it.reason == want
        ok &= good
        print("PASS" if good else "FAIL", want, "<-", it.reason, "|", url[:50])
    # contagion check
    items = [Item("https://some-site.example.org/a", "ok", []), Item("https://some-site.example.org/b", "porn clip", [])]
    kept = [i for i in run_filter(items) if i.reason is None]
    kept = [i for i in kept]
    taint = all(i.reason in ("domain_contagion", "adult") for i in items)
    print("PASS" if taint else "FAIL", "domain contagion taints non-allowlisted same-domain items")
    ok &= taint
    items = [Item("https://www.youtube.com/watch?v=1", "ok", []), Item("https://www.youtube.com/watch?v=2", "porn clip", [])]
    run_filter(items)
    plat = items[0].reason is None and items[1].reason == "adult"
    print("PASS" if plat else "FAIL", "big platforms: only the flagged item is dropped")
    ok &= plat
    print("SELFTEST", "OK" if ok else "FAILED")
    sys.exit(0 if ok else 1)


def main() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == "selftest":
        selftest()
    if len(sys.argv) < 3 or sys.argv[1] != "run":
        print("usage: filter_bookmarks.py selftest | run <bookmarks.html>")
        sys.exit(2)
    raw = Path(sys.argv[2]).read_text(encoding="utf-8", errors="replace")
    p = Parser()
    p.feed(raw)
    items = p.items
    cands = run_filter(items)  # passed every keyword/privacy rule (allowlisted or not)
    reasons = Counter(i.reason for i in items if i.reason not in (None, "not_allowlisted"))
    print(f"total links: {len(items)}")
    print(f"dropped by rules (counts only): {dict(reasons.most_common())}")
    print(f"candidates for local-LLM stage: {len(cands)}")
    kept_cat, why = llm_stage(cands)
    print(f"dropped by local LLM (counts only): {dict(why.most_common())}")
    print(f"LLM failure types (counts only): {dict(FAIL_TYPES.most_common())}")
    print(f"KEPT: {len(kept_cat)}")
    print("kept by category:", dict(Counter(c for _, c in kept_cat).most_common()))
    allowed_kept = Counter(i.host for i, _ in kept_cat if i.host in ALLOW_DOMAINS)
    print("kept from allowlisted domains:", dict(allowed_kept.most_common(15)))
    kept = [i for i, _ in kept_cat]
    cat_of = {id(i): c for i, c in kept_cat}
    rows = [{"domain": i.host, "title": clean_title(i.title), "category": cat_of[id(i)]} for i in kept]
    seen, dedup = set(), []
    for r in rows:
        k = (r["domain"], r["title"].casefold())
        if k not in seen:
            seen.add(k)
            dedup.append(r)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(dedup, ensure_ascii=False, indent=1), encoding="utf-8")
    OUT.chmod(0o600)
    print(f"wrote {len(dedup)} deduped kept rows -> {OUT.relative_to(HERE)} (local only, no dropped items stored)")


if __name__ == "__main__":
    main()
