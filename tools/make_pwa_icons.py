"""Draws the app icon (an eye with a slash: seen by no one but you) as PNGs and the SVG master.
Usage: python3 -B tools/make_pwa_icons.py   ->  web/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, icon.svg
"""
from pathlib import Path
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "icons"; OUT.mkdir(parents=True, exist_ok=True)
BG, FG = (67, 56, 202), (255, 255, 255)  # indigo, white (same accent as the default theme)

def draw(size, glyph_scale, rounded):
    S = size * 4  # draw at 4x, then shrink for smooth edges
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22) if rounded else 0, fill=BG)
    cx = cy = S / 2; w = S * glyph_scale; lw = max(2, int(S * 0.045))
    d.ellipse([cx - w / 2, cy - w * 0.30, cx + w / 2, cy + w * 0.30], outline=FG, width=lw)       # eye
    d.ellipse([cx - w * 0.14, cy - w * 0.14, cx + w * 0.14, cy + w * 0.14], fill=FG)               # pupil
    d.line([cx - w * 0.46, cy + w * 0.40, cx + w * 0.46, cy - w * 0.40], fill=BG, width=lw * 3)    # gap for the slash
    d.line([cx - w * 0.46, cy + w * 0.40, cx + w * 0.46, cy - w * 0.40], fill=FG, width=lw)        # slash
    return im.resize((size, size), Image.LANCZOS)

draw(192, 0.62, True).save(OUT / "icon-192.png")
draw(512, 0.62, True).save(OUT / "icon-512.png")
draw(512, 0.46, False).save(OUT / "icon-maskable-512.png")   # full-bleed, glyph inside the safe zone
draw(180, 0.62, False).save(OUT / "apple-touch-icon.png")    # iOS rounds the corners itself
(OUT / "icon.svg").write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#4338ca"/>
<g fill="none" stroke="#fff" stroke-width="23" stroke-linecap="round"><ellipse cx="256" cy="256" rx="159" ry="95"/><path d="M114 392 398 120" stroke="#4338ca" stroke-width="69"/><path d="M114 392 398 120"/></g><circle cx="256" cy="256" r="44" fill="#fff"/></svg>
''')
print("icons written to", OUT)
