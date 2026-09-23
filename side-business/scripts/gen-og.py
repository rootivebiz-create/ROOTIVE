"""リンクを共有したときの画像（1200×630）を作る。python3 scripts/gen-og.py FONT_BOLD FONT_REGULAR"""
import sys
from PIL import Image, ImageDraw, ImageFont

bold, regular = sys.argv[1], sys.argv[2]
W, H = 1200, 630
PLATE = (22, 23, 26)
YELLOW = (245, 196, 0)
WHITE = (240, 240, 236)
GREY = (170, 172, 178)

img = Image.new("RGB", (W, H), PLATE)
d = ImageDraw.Draw(img)

# 左上のロゴ（黄色の枠に「締」）
d.rounded_rectangle([80, 80, 200, 200], radius=16, outline=YELLOW, width=6)
f_logo = ImageFont.truetype(bold, 80)
box = d.textbbox((0, 0), "締", font=f_logo)
d.text((140 - (box[2] - box[0]) / 2 - box[0], 140 - (box[3] - box[1]) / 2 - box[1]), "締", font=f_logo, fill=YELLOW)
d.text((230, 108), "しめ日ラボ", font=ImageFont.truetype(bold, 56), fill=WHITE)

f_main = ImageFont.truetype(bold, 64)
# SITE.tagline（site.config.ts）と同じ中身。変えたらここも直して作り直す
d.text((80, 270), "月末の締めを、今のExcelのまま。", font=f_main, fill=WHITE)
d.text((80, 355), "元請の支払通知とのズレも円で。", font=f_main, fill=YELLOW)

f_sub = ImageFont.truetype(regular, 32)
d.text((80, 480), "軽貨物・運送会社向け｜支払明細・ドライバーの確認・振込データ", font=f_sub, fill=GREY)

img.save("public/og.png", optimize=True)
