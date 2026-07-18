#!/usr/bin/env python3
"""
RPランキングを画像化する。stdin から TSV を受け取り PNG を出力する。

使い方:
  cd server && npx tsx scripts/rank-points-ranking.ts --prod --top=30 --tsv \
    | python3 scripts/render-rp-ranking.py /tmp/rp-ranking.png

出力レイアウト:
  6:4 の横長キャンバスに2カラム表示。左カラムに 1〜15 位、右カラムに 16〜30 位。
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
SUB_TEXT    = (74, 63, 48)      # cream-800（cream-700以下は薄すぎるため使用しない）
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
footers = []  # #footer= は複数行可。出現順に画像下部へ描画する
rows = []
for l in lines:
    if l.startswith("#"):
        k, _, v = l[1:].partition("=")
        k, v = k.strip(), v.strip()
        if k == "footer":
            if v:
                footers.append(v)
        else:
            meta[k] = v
    elif "\t" in l:
        rows.append(l.split("\t"))

title = meta.get("title", "BabyPLO トーナメント RP ランキング")
subtitle = meta.get("subtitle", "")

# ---- レイアウト（6:4 横長 / 2カラム） ----
W = 1500
PAD = 40
GAP = 40
ROW_H = 54
HEADER_H = 64
TITLE_H = 140
FOOTER_LINE_H = 30
FOOTER_H = 24 + FOOTER_LINE_H * len(footers) if footers else 20

HALF = 15
left_rows = rows[:HALF]
right_rows = rows[HALF:HALF * 2]
col_rows = max(len(left_rows), len(right_rows))

H = TITLE_H + HEADER_H + ROW_H * col_rows + FOOTER_H + PAD

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# ---- タイトル ----
d.text((PAD, 28), title, font=f(36, True), fill=ACCENT)
if subtitle:
    d.text((PAD, 84), subtitle, font=f(20), fill=SUB_TEXT)

# 列定義: (label, x_left(カード内オフセット), align, width)  align: 'l'/'r'/'c'
COLS = [
    ("順位",  16, "c",  50),
    ("名前",  76, "l", 200),
    ("RP",   286, "r",  80),
    ("出場", 376, "r",  60),
    ("RP圏", 446, "r",  60),
    ("優勝", 516, "r",  60),
    ("最高", 586, "r",  60),
]

card_w = (W - PAD * 2 - GAP) // 2
card_y = TITLE_H


def draw_card(card_x, rows_chunk):
    if not rows_chunk:
        return
    card_h = HEADER_H + ROW_H * len(rows_chunk)

    # カード枠
    d.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + card_h],
                        radius=12, fill=CARD_BG, outline=BORDER, width=1)

    # ヘッダ（上部だけ角丸）
    d.rounded_rectangle([card_x, card_y, card_x + card_w, card_y + HEADER_H],
                        radius=12, fill=HEADER_BG)
    d.rectangle([card_x, card_y + 12, card_x + card_w, card_y + HEADER_H], fill=HEADER_BG)

    for label, x, align, w in COLS:
        fnt = f(20, True)
        bbox = d.textbbox((0, 0), label, font=fnt)
        tw = bbox[2] - bbox[0]
        if align == "r":
            tx = card_x + x + w - tw
        elif align == "c":
            tx = card_x + x + (w - tw) // 2
        else:
            tx = card_x + x
        d.text((tx, card_y + 19), label, font=fnt, fill=HEADER_FG)

    # 行
    for i, row in enumerate(rows_chunk):
        y = card_y + HEADER_H + ROW_H * i
        if i % 2 == 1:
            d.rectangle([card_x + 1, y, card_x + card_w - 1, y + ROW_H],
                        fill=(252, 250, 247))
        if i > 0:
            d.line([card_x + 12, y, card_x + card_w - 12, y], fill=BORDER, width=1)

        rank, name, rp, ent, win, itm, best = row
        rank_int = int(rank)

        cells = [rank, name, rp, ent, itm, win, best]
        for (label, x, align, cw), val in zip(COLS, cells):
            if label == "順位":
                cx = card_x + x + cw // 2
                cy = y + ROW_H // 2
                r = 17
                color = None
                if rank_int == 1: color = GOLD
                elif rank_int == 2: color = SILVER
                elif rank_int == 3: color = BRONZE
                if color:
                    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
                    fnt = f(17, True)
                    fg = (255, 255, 255)
                else:
                    fnt = f(18, True)
                    fg = TEXT
                bbox = d.textbbox((0, 0), val, font=fnt)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
                d.text((cx - tw // 2, cy - th // 2 - 2), val, font=fnt, fill=fg)
                continue

            if label == "RP":
                fnt = f(22, True)
                fg = ACCENT
            elif label == "名前":
                fnt = f(20, True)
                fg = TEXT
            else:
                fnt = f(22)
                fg = TEXT
                if label == "優勝" and val != "0":
                    fnt = f(22, True)
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


draw_card(PAD, left_rows)
draw_card(PAD + card_w + GAP, right_rows)

# ---- フッター ----
fy = TITLE_H + HEADER_H + ROW_H * col_rows + 24
for line in footers:
    d.text((PAD, fy), line, font=f(16), fill=SUB_TEXT)
    fy += FOOTER_LINE_H

img.save(OUT_PATH)
print(f"saved: {OUT_PATH}", file=sys.stderr)
