"""アプリのアイコン（黒地に黄色の「黒」）を作る。python3 scripts/gen-icons.py FONT_PATH"""
import sys
from PIL import Image, ImageDraw, ImageFont

font_path = sys.argv[1]
PLATE = (22, 23, 26)
YELLOW = (245, 196, 0)

def icon(size, path, pad_ratio=0.0):
    img = Image.new("RGB", (size, size), PLATE)
    d = ImageDraw.Draw(img)
    pad = int(size * (0.12 + pad_ratio))
    r = int(size * 0.08)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=r, outline=YELLOW, width=max(2, size // 32))
    font = ImageFont.truetype(font_path, int((size - 2 * pad) * 0.62))
    text = "黒"
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), text, font=font, fill=YELLOW)
    img.save(path, optimize=True)

icon(512, "public/icon-512.png")
icon(192, "public/icon-192.png")
icon(180, "public/apple-touch-icon.png")
icon(48, "app/icon.png")
