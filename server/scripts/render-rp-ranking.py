#!/usr/bin/env python3
"""
RPランキングを画像化する。stdin から TSV を受け取り PNG を出力する。

使い方:
  cd server && npx tsx scripts/rank-points-ranking.ts --prod --top=30 --tsv \
    | python3 scripts/render-rp-ranking.py /tmp/rp-ranking.png
"""
import sys
from PIL import Image, ImageDraw, ImageFont

OUT_PATH = sys.argv[1] if len(sys.argv) > 1 else "/tmp/rp-ranking.png"

# cream/forest パレット
BG          = (245, 240, 235)   # cream-200
CARD_BG     = (255, 255, 255)
HEADER_BG   = (45, 90, 61)      # forest DEFAULT
HEADER_FG   = (250, 248, 245)   # cream-100
TEXT        = (26, 26, 26)      # cream-900
SUB_TEXT    = (107, 94, 74)     # cream-700
BORDER      = (232, 224, 212)   # cream-300
GOLD        = (212, 175, 55)
SILVER      = (170, 170, 170)
BRONZE      = (176, 119, 67)
ACCENT      = (45, 90, 61)      # forest

FONT_REG = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
FONT_BOLD = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"

def f(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)

# ---- 入力読み取り ----
lines = [l.rstrip("\n") for l in sys.stdin if l.strip()]
meta = {}
rows = []
for l in lines:
    if l.startswith("#"):
        k, _, v = l[1:].partition("=")
        meta[k.strip()] = v.strip()
    elif "\t" in l:
        rows.append(l.split("\t"))

title = meta.get("title", "BabyPLO トーナメント RP ランキング")
subtitle = meta.get("subtitle", "")

# ---- レイアウト ----
W = 900
PAD = 40
ROW_H = 44
HEADER_H = 56
TITLE_H = 130
FOOTER_H = 50
H = TITLE_H + HEADER_H + ROW_H * len(rows) + FOOTER_H + PAD

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# ---- タイトル ----
d.text((PAD, 30), title, font=f(32, True), fill=ACCENT)
if subtitle:
    d.text((PAD, 78), subtitle, font=f(18), fill=SUB_TEXT)

# ---- カード本体 ----
card_x = PAD
card_y = TITLE_H
card_w = W - PAD * 2
card_h = HEADER_H + ROW_H * len(rows)
d.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + card_h],
                    radius=12, fill=CARD_BG, outline=BORDER, width=1)

# 列定義: (label, x_left, align)  align: 'l' or 'r' or 'c'
COLS = [
    ("順位", 24,   "c", 60),
    ("名前", 100,  "l", 240),
    ("RP",   360,  "r", 90),
    ("出場", 470,  "r", 70),
    ("優勝", 550,  "r", 70),
    ("RP圏", 630,  "r", 70),
    ("最高", 710,  "r", 70),
]

# ---- ヘッダ ----
d.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + HEADER_H],
                    radius=12, fill=HEADER_BG)
# 下半分を四角に上書きして角丸を上だけにする
d.rectangle([card_x, card_y + 12, card_x + card_w, card_y + HEADER_H], fill=HEADER_BG)

for label, x, align, w in COLS:
    fnt = f(18, True)
    bbox = d.textbbox((0, 0), label, font=fnt)
    tw = bbox[2] - bbox[0]
    if align == "r":
        tx = card_x + x + w - tw
    elif align == "c":
        tx = card_x + x + (w - tw) // 2
    else:
        tx = card_x + x
    d.text((tx, card_y + 16), label, font=fnt, fill=HEADER_FG)

# ---- 行 ----
for i, row in enumerate(rows):
    y = card_y + HEADER_H + ROW_H * i
    # 縞模様
    if i % 2 == 1:
        d.rectangle([card_x + 1, y, card_x + card_w - 1, y + ROW_H],
                    fill=(252, 250, 247))
    # 区切り線
    if i > 0:
        d.line([card_x + 12, y, card_x + card_w - 12, y], fill=BORDER, width=1)

    rank, name, rp, ent, win, itm, best = row
    rank_int = int(rank)

    cells = [rank, name, rp, ent, win, itm, best]
    for (label, x, align, cw), val in zip(COLS, cells):
        if label == "順位":
            # メダル丸
            cx = card_x + x + cw // 2
            cy = y + ROW_H // 2
            r = 14
            color = None
            if rank_int == 1: color = GOLD
            elif rank_int == 2: color = SILVER
            elif rank_int == 3: color = BRONZE
            if color:
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
                fnt = f(14, True)
                fg = (255, 255, 255)
            else:
                fnt = f(16, True)
                fg = SUB_TEXT
            bbox = d.textbbox((0, 0), val, font=fnt)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            d.text((cx - tw // 2, cy - th // 2 - 2), val, font=fnt, fill=fg)
            continue

        if label == "RP":
            fnt = f(18, True)
            fg = ACCENT
        elif label == "名前":
            fnt = f(17, True)
            fg = TEXT
        else:
            fnt = f(15)
            fg = SUB_TEXT
            if label == "優勝" and val != "0":
                fnt = f(15, True)
                fg = GOLD

        bbox = d.textbbox((0, 0), val, font=fnt)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        if align == "r":
            tx = card_x + x + cw - tw
        elif align == "c":
            tx = card_x + x + (cw - tw) // 2
        else:
            tx = card_x + x
        d.text((tx, y + (ROW_H - th) // 2 - 2), val, font=fnt, fill=fg)

# ---- フッター ----
footer = meta.get("footer", "")
if footer:
    d.text((PAD, H - FOOTER_H + 8), footer, font=f(14), fill=SUB_TEXT)

img.save(OUT_PATH)
print(f"saved: {OUT_PATH}", file=sys.stderr)
