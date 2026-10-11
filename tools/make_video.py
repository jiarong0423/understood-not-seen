"""Assembles the demo video: Veo opening + the owner's screen recording (trimmed) + Veo weekend + Veo dusk, music, burnt-in English subtitles.
Usage: python3 -B tools/make_video.py <screen_recording.mov> <music.mp3>
Inputs in docs/video_assets/: A_opening_window.mp4, B_weekend_badminton.mp4, C_closing_dusk.mp4. Output: docs/video_assets/final_subtitled_draft.mp4
The subtitle text below is a DRAFT; the owner finalises the English (one place to edit: LINES and SCREEN_CUTS).
"""
import os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "docs", "video_assets")
REC, MUSIC = sys.argv[1], sys.argv[2]
W, H, FPS = 1920, 1080, 30
BG = "0xf6f3ec"  # the page background, used to pad the screen recording to 16:9

# parts of the screen recording to keep (seconds in the original file): the chat window before 15 s, a blank loading page
# at 70.7-71.9 s, and the share sheet and desktop after 87.2 s are cut out
SCREEN_CUTS = [(15.2, 70.7), (71.9, 87.2)]
CROP_BOTTOM = 92  # after the map window opened, 90 px of desktop showed under the browser; cut from the whole screen part
A, B, C = 10.0, 10.0, 10.05
screen_len = sum(b - a for a, b in SCREEN_CUTS)
T_B = A + screen_len
T_C = T_B + B
TOTAL = T_C + C

# (start, end, text, style) on the final timeline; style "sub" = bottom subtitle, "title" = centred closing title
LINES = [
    (0.5, 9.5, "Most apps ask for your history first, then guess who you are.", "sub"),
    (10.0, 22.3, "Here, your bookmarks are read inside your own browser. Only what you approve ever leaves it.", "sub"),
    (22.8, 32.3, "Gate one: private links go first. Accounts, personal pages, private addresses. Only counts are shown.", "sub"),
    (32.8, 42.3, "It sees what you saved, badminton, cafés, bowling, and suggests what sits next to them.", "sub"),
    (42.8, 54.3, "Gate two: tick the café you love, ask for quality, and see every word that would leave your device.", "sub"),
    (54.8, 65.3, "Qloo returns real places, ranked by the taste of the café you saved.", "sub"),
    (65.6, 71.1, "Every place opens on the map.", "sub"),
    (71.6, 76.7, "Every request to Qloo is listed. The key is never shown.", "sub"),
    (76.8, 82.2, "And it looks forward: the long weekend is coming. Invite a friend.", "sub"),
    (82.4, T_C - 0.3, "So this weekend, we actually went.", "sub"),
    (T_C + 1.0, TOTAL - 0.2, "Understood, not seen.", "title"),
]

# narration (Gemini TTS, voice Achernar), placed just after each subtitle appears: (file in docs/video_assets/voice, start second)
VOICE = [("line01.wav", 0.8), ("line02.wav", 10.3), ("line03.wav", 23.0), ("line04.wav", 33.0), ("line05.wav", 43.0), ("line06.wav", 55.0),
         ("line07.wav", 65.8), ("line08.wav", 71.8), ("line09.wav", 76.9), ("line10.wav", 82.5), ("line11.wav", 92.2)]

FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_B = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def run(args):
    subprocess.run(args, check=True)


def wrap(draw, text, font, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= maxw:
            cur = t
        else:
            lines.append(cur); cur = w
    lines.append(cur)
    return lines


def subtitle_png(text, style, path):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if style == "title":
        f = ImageFont.truetype(FONT_B, 92)
        tw = d.textlength(text, font=f)
        d.text(((W - tw) / 2 + 3, H / 2 - 52 + 3), text, font=f, fill=(0, 0, 0, 120))
        d.text(((W - tw) / 2, H / 2 - 52), text, font=f, fill=(255, 255, 255, 255))
        f2 = ImageFont.truetype(FONT, 34); s = "Your bookmarks stay on your device. Places by Qloo. Demo data."
        sw = d.textlength(s, font=f2); d.text(((W - sw) / 2, H / 2 + 62), s, font=f2, fill=(255, 255, 255, 230))
    else:
        f = ImageFont.truetype(FONT, 44)
        lines = wrap(d, text, f, 1500); lh = 58
        boxw = max(d.textlength(l, font=f) for l in lines) + 56; boxh = lh * len(lines) + 30
        x0, y0 = (W - boxw) / 2, H - 70 - boxh
        d.rounded_rectangle([x0, y0, x0 + boxw, y0 + boxh], radius=16, fill=(15, 15, 25, 165))
        for i, l in enumerate(lines):
            lw = d.textlength(l, font=f); d.text(((W - lw) / 2, y0 + 15 + i * lh), l, font=f, fill=(255, 255, 255, 255))
    im.save(path)


with tempfile.TemporaryDirectory() as tmp:
    # 1. screen part: keep the chosen ranges, fit to 1920x1080 on the page colour
    trims = "".join(f"[0:v]trim={a}:{b},setpts=PTS-STARTPTS[s{i}];" for i, (a, b) in enumerate(SCREEN_CUTS))
    joins = "".join(f"[s{i}]" for i in range(len(SCREEN_CUTS)))
    screen = os.path.join(tmp, "screen.mp4")
    run(["ffmpeg", "-v", "error", "-y", "-i", REC, "-filter_complex",
         f"{trims}{joins}concat=n={len(SCREEN_CUTS)}:v=1:a=0,crop=iw:ih-{CROP_BOTTOM}:0:0,scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG},fps={FPS},format=yuv420p[v]",
         "-map", "[v]", "-c:v", "libx264", "-crf", "18", "-preset", "medium", screen])
    # 2. Veo clips to the same size and rate, no sound
    parts = []
    for name in ["A_opening_window.mp4", screen, "B_weekend_badminton.mp4", "C_closing_dusk.mp4"]:
        src = name if os.path.isabs(name) else os.path.join(ASSETS, name)
        out = os.path.join(tmp, "p%d.mp4" % len(parts))
        run(["ffmpeg", "-v", "error", "-y", "-i", src, "-an", "-vf", f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps={FPS},format=yuv420p",
             "-c:v", "libx264", "-crf", "18", "-preset", "medium", out])
        parts.append(out)
    # 3. subtitles as transparent images, overlaid only during their time
    pngs = []
    for i, (a, b, text, style) in enumerate(LINES):
        p = os.path.join(tmp, "sub%02d.png" % i); subtitle_png(text, style, p); pngs.append((p, a, b))
    inputs = []
    for p in parts:
        inputs += ["-i", p]
    inputs += ["-i", MUSIC]
    for p, _, _ in pngs:
        inputs += ["-loop", "1", "-i", p]
    vstart = len(parts) + 1 + len(pngs)  # inputs: video parts, music, subtitle images, then the voice lines
    for f, _ in VOICE:
        inputs += ["-i", os.path.join(ASSETS, "voice", f)]
    n = len(parts); m = n  # music input index
    fc = "".join(f"[{i}:v]" for i in range(n)) + f"concat=n={n}:v=1:a=0[base];"
    last = "base"
    for k, (_, a, b) in enumerate(pngs):
        idx = n + 1 + k
        fc += f"[{last}][{idx}:v]overlay=0:0:enable='between(t,{a:.2f},{b:.2f})':shortest=1[v{k}];"
        last = f"v{k}"
    # narration: each line delayed to its start, mixed into one track; the music ducks under it (sidechain) and fades in and out
    for j, (_, st) in enumerate(VOICE):
        fc += f"[{vstart + j}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={int(st * 1000)}|{int(st * 1000)},volume=1.35[vo{j}];"
    fc += "".join(f"[vo{j}]" for j in range(len(VOICE))) + f"amix=inputs={len(VOICE)}:normalize=0:duration=longest,apad=whole_dur={TOTAL:.2f}[vo];"
    fc += "[vo]asplit=2[vo_mix][vo_key];"
    fc += f"[{m}:a]atrim=0:{TOTAL:.2f},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=0.5,afade=t=in:st=0:d=1.5,afade=t=out:st={TOTAL - 3:.2f}:d=3[mus];"
    fc += "[mus][vo_key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=500[duck];"
    fc += "[duck][vo_mix]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89:level=false[a]"  # a limiter keeps peaks under -1 dB
    out = os.path.join(ASSETS, "final_subtitled_draft.mp4")
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", fc, "-map", f"[{last}]", "-map", "[a]", "-t", f"{TOTAL:.2f}",
         "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out])
    print("made", out, "length %.1f s" % TOTAL)
