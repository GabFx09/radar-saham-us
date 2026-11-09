"""Membuat ikon PWA (PNG) — jalankan sekali: python scripts/make_icons.py"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "icons")
os.makedirs(OUT, exist_ok=True)

C1, C2 = (16, 185, 129), (56, 189, 248)


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = ((x) + (size - y)) / (2 * size)
            px[x, y] = tuple(int(C1[i] + (C2[i] - C1[i]) * t) for i in range(3))
    return img


def make(size, maskable=False, radius=0.28):
    S = size * 4  # supersampling
    bg = gradient(S)
    mask = Image.new("L", (S, S), 0)
    if maskable:
        mask = Image.new("L", (S, S), 255)
    else:
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius), fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(out)
    k = 0.72 if maskable else 1.0  # zona aman maskable
    off = S * (1 - k) / 2

    def P(x, y):
        return (off + x / 32 * S * k, off + y / 32 * S * k)

    pts = [P(7, 21), P(13, 15), P(17, 19), P(25, 10)]
    w = int(S * k * 2.8 / 32)
    d.line(pts, fill="white", width=w, joint="curve")
    for p in pts[:1] + pts[-1:]:
        r = w / 2
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill="white")
    cx, cy = P(25, 10)
    rr = S * k * 2.6 / 32
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill="white")
    return out.resize((size, size), Image.LANCZOS)


make(192).save(os.path.join(OUT, "icon-192.png"))
make(512).save(os.path.join(OUT, "icon-512.png"))
make(512, maskable=True).save(os.path.join(OUT, "maskable-512.png"))
make(180, maskable=True).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))

with open(os.path.join(OUT, "icon.svg"), "w", encoding="utf-8") as f:
    f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="1" '
            'x2="1" y2="0"><stop offset="0" stop-color="#10b981"/><stop offset="1" stop-color="#38bdf8"/>'
            '</linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#g)"/><path d="M7 21l6-6 4 4 8-9" '
            'stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
            '<circle cx="25" cy="10" r="2.2" fill="#fff"/></svg>')
print("Ikon dibuat di", OUT)
