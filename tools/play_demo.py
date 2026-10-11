"""Plays the demo in a VISIBLE browser window so the owner can screen-record it (Playwright drives the page; the real mouse is never touched).
Flow: opens the window (English, light), prints READY, waits until the file /tmp/uns_demo_go exists, then performs the scenes in real time:
landing, sample bookmarks and the privacy gate, ideas / taste / quality / what leaves the device, Find places, results, a click on a Map link
(the map window is moved over the same spot), the Evidence panel, the invitation and Invite a friend. Closes itself at the end.
Usage:  python3 -B tools/play_demo.py            (then:  touch /tmp/uns_demo_go  to start)
Needs the local server running with a Qloo key. Nothing is uploaded; the profile is temporary.
"""
import json, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("DEMO_URL", "http://127.0.0.1:8770")
GO = "/tmp/uns_demo_go"
DRY = os.environ.get("DRY") == "1"  # a rehearsal: hidden window, no waiting, same steps
W, H = 1440, 820

health = json.load(urllib.request.urlopen(BASE + "/api/health", timeout=10))
if not health.get("configured"):
    sys.exit("ERROR the server at %s has no Qloo key: the places step would fail. Aborting." % BASE)
if os.path.exists(GO):
    os.remove(GO)

CURSOR = """(() => { const add = () => { if (document.getElementById('demo-cursor')) return; const c = document.createElement('div'); c.id='demo-cursor';
  c.style.cssText='position:fixed;z-index:99999;pointer-events:none;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(67,56,202,.28);border:2px solid #4338ca;left:-50px;top:-50px;transition:transform .12s';
  document.body.appendChild(c); document.addEventListener('mousemove', e => { c.style.left=e.clientX+'px'; c.style.top=e.clientY+'px'; }, true);
  document.addEventListener('mousedown', () => c.style.transform='scale(.7)', true); document.addEventListener('mouseup', () => c.style.transform='scale(1)', true); };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add); })()"""


def ease(k):
    return 2 * k * k if k < 0.5 else 1 - pow(-2 * k + 2, 2) / 2


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=DRY, args=["--window-position=0,25", "--window-size=%d,%d" % (W, H + 90), "--lang=en-US"])
    ctx = browser.new_context(viewport={"width": W, "height": H}, locale="en-US", color_scheme="light", permissions=["clipboard-read", "clipboard-write"])
    ctx.add_init_script(CURSOR)
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="networkidle")
    if page.evaluate("document.documentElement.lang") != "en":
        page.click("#lang"); page.wait_for_timeout(600)
    assert page.evaluate("document.documentElement.lang") == "en", "the page is not in English"
    assert not page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches"), "the page is in dark mode"
    pos = {"x": W / 2, "y": 120}
    page.mouse.move(pos["x"], pos["y"])

    def move(x, y, ms=600, pg=None):
        pg = pg or page
        steps = max(8, int(ms / 30))
        x0, y0 = pos["x"], pos["y"]
        for i in range(1, steps + 1):
            e = ease(i / steps)
            pg.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e)
            time.sleep(ms / 1000 / steps)
        pos["x"], pos["y"] = x, y

    def center(sel):
        r = page.evaluate("(s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; }", sel)
        if not r:
            raise RuntimeError("missing " + sel)
        return r

    def click(sel):
        x, y = center(sel)
        move(x, y, 700)
        page.mouse.down(); time.sleep(0.09); page.mouse.up(); time.sleep(0.3)

    def click_text(sel, text):
        idx = page.evaluate("([s, t]) => [...document.querySelectorAll(s)].findIndex(e => e.textContent.includes(t))", [sel, text])
        if idx < 0:
            raise RuntimeError("no %s with %s" % (sel, text))
        click("%s:nth-of-type(%d)" % (sel, idx + 1))

    def scroll_to(sel, offset=90, ms=1100):
        page.evaluate("([s, o]) => { const e = document.querySelector(s); window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - o, behavior: 'smooth' }); }", [sel, offset])
        time.sleep(ms / 1000)

    print("READY: window is open in English. Start your screen recording, then run:  touch %s" % GO, flush=True)
    t0 = time.time()
    while not DRY and not os.path.exists(GO):
        if time.time() - t0 > 1800:
            sys.exit("timed out waiting for the start signal")
        time.sleep(0.3)
    if not DRY:
        os.remove(GO)
    print("GO", flush=True)

    # S1 landing
    move(W * 0.62, 150, 900); time.sleep(2.2); scroll_to(".flow", 120, 1400); time.sleep(2.6)
    page.evaluate("window.scrollTo({top:0,behavior:'smooth'})"); time.sleep(1.5)
    # S2 sample bookmarks and the gate
    click("#sample"); time.sleep(2.0)
    assert page.evaluate("!document.getElementById('s2').classList.contains('hide')"), "the sample bookmarks did not load (the click did not land)"
    scroll_to("#s2", 70, 1200); time.sleep(7.0)
    # S3 ideas, extension, taste and quality, payload
    scroll_to("#s4", 60, 1200); time.sleep(4.5); scroll_to("#expandBox", 80, 1100); time.sleep(1.8)
    scroll_to("#tasteBox", 120, 1000); click_text("#taste .chip", "Simple Kaffa"); time.sleep(0.9)
    click("#quality"); time.sleep(0.9); scroll_to(".payload", 200, 1100); time.sleep(5.0)
    # S4 find places, results
    click("#go")
    page.wait_for_function("document.querySelectorAll('.res').length > 0 && !document.querySelector('.skeleton')", timeout=90000)
    time.sleep(0.5); scroll_to("#s5", 60, 1200); time.sleep(3.8)
    page.evaluate("window.scrollBy({top: 330, behavior: 'smooth'})"); time.sleep(2.6)
    # S4b Map link: the map window opens, is shown 5.5 s over the same spot, then closed
    page.evaluate("document.querySelector('a.pl-map').scrollIntoView({behavior:'smooth', block:'center'})"); time.sleep(1.3)
    x, y = center("a.pl-map"); move(x, y, 700)
    with ctx.expect_page(timeout=15000) as popup_info:
        page.mouse.down(); time.sleep(0.09); page.mouse.up()
    popup = popup_info.value
    try:
        popup.wait_for_load_state("domcontentloaded", timeout=15000)
        popup.evaluate("(a) => { window.moveTo(a[0], a[1]); window.resizeTo(a[2], a[3]); }", [0, 25, W, H + 90])
    except Exception as e:
        print("note: could not place the map window:", e, flush=True)
    time.sleep(5.5)
    popup.close(); page.bring_to_front(); time.sleep(0.8)
    # S4c Evidence panel
    click(".evid summary"); time.sleep(0.6)
    page.evaluate("document.querySelector('.evid').scrollIntoView({behavior:'smooth', block:'center'})"); time.sleep(3.2)
    # S5 invitation and Invite a friend
    scroll_to(".invite", 90, 1100); time.sleep(1.5); click("#inviteBtn"); time.sleep(2.6)
    print("DONE", flush=True)
    time.sleep(1.5)
    browser.close()
