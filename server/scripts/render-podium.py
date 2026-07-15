#!/usr/bin/env python3
"""
トーナメント結果ツイート用の表彰台画像を生成する。

tournament-tweet-data.ts の JSON を stdin から受け取り、
上位3名（topResults の position 1〜3）のアイコンを表彰台に載せた PNG を出力する。

使い方:
  cd server && npx tsx scripts/tournament-tweet-data.ts --prod \
    | python3 scripts/render-podium.py /tmp/tournament-podium.png

アイコンの解決:
  - http(s) URL         → ダウンロード（失敗時はシルエットにフォールバック）
  - /images/... のパス  → リポジトリの public/ 配下から読む
  - SVG（anonymous.svg 等）→ PIL で読めないためシルエットを描画
"""
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT_PATH = sys.argv[1] if len(sys.argv) > 1 else "/tmp/tournament-podium.png"
REPO_ROOT = Path(__file__).resolve().parents[2]

# cream/forest パレット（render-rp-ranking.py と同じ）
BG        = (245, 240, 235)   # cream-200
CARD_BG   = (255, 255, 255)
FOREST    = (45, 90, 61)      # forest DEFAULT
FOREST_DK = (34, 68, 46)
CREAM_100 = (250, 248, 245)
TEXT      = (26, 26, 26)      # cream-900
SUB_TEXT  = (74, 63, 48)      # cream-800（cream-700以下は薄すぎるため使用しない）
BORDER    = (232, 224, 212)   # cream-300
GOLD      = (212, 175, 55)
SILVER    = (168, 168, 172)
BRONZE    = (176, 119, 67)

FONT_REG = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
FONT_BOLD = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"

RANK_LABELS = {1: "1st", 2: "2nd", 3: "3rd"}
RANK_COLORS = {1: GOLD, 2: SILVER, 3: BRONZE}


def f(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


# ---- 入力読み取り（dotenv 等のログ行が混ざっても、行頭が { の行以降を JSON として読む） ----
lines = sys.stdin.read().splitlines()
start = next((i for i, l in enumerate(lines) if l.startswith("{")), -1)
if start < 0:
    print("ERROR: stdin に JSON が見つかりません", file=sys.stderr)
    sys.exit(1)
data = json.loads("\n".join(lines[start:]))

title = data["tournament"]["name"]
top3 = sorted(
    [r for r in data["topResults"] if 1 <= r["position"] <= 3],
    key=lambda r: r["position"],
)
if not top3:
    print("ERROR: topResults が空です", file=sys.stderr)
    sys.exit(1)


def load_avatar(url: str) -> Image.Image | None:
    """アイコンを読み込む。読めない場合は None（シルエットにフォールバック）。"""
    try:
        if url.startswith("http://") or url.startswith("https://"):
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as res:
                buf = res.read()
            return Image.open(io.BytesIO(buf)).convert("RGBA")
        local = REPO_ROOT / "public" / url.lstrip("/")
        if local.suffix.lower() == ".svg" or not local.exists():
            return None
        return Image.open(local).convert("RGBA")
    except Exception as e:
        print(f"warn: アイコン読み込み失敗 ({url}): {e}", file=sys.stderr)
        return None


def silhouette_avatar(size_px: int) -> Image.Image:
    """anonymous.svg 相当の人型シルエット。"""
    im = Image.new("RGBA", (size_px, size_px), (205, 209, 214, 255))
    sd = ImageDraw.Draw(im)
    c = (130, 140, 152, 255)
    head_r = size_px * 0.18
    cx, cy = size_px / 2, size_px * 0.40
    sd.ellipse([cx - head_r, cy - head_r, cx + head_r, cy + head_r], fill=c)
    sd.ellipse([size_px * 0.22, size_px * 0.62, size_px * 0.78, size_px * 1.15], fill=c)
    return im


# ---- キャンバス（16:9 / 2x スーパーサンプリング） ----
W, H = 1200, 675
SS = 2
img = Image.new("RGB", (W * SS, H * SS), BG)
d = ImageDraw.Draw(img)


def S(v):
    return round(v * SS)


# ---- 背景の飾り（四隅にごく薄いスート柄） ----
SUIT_DECOR = (236, 229, 220)
fnt_suit = f(S(96))
for suit, (sx, sy) in [
    ("♠", (36, 24)), ("♥", (W - 120, 24)),
    ("♣", (36, H - 130)), ("♦", (W - 120, H - 130)),
]:
    d.text((S(sx), S(sy)), suit, font=fnt_suit, fill=SUIT_DECOR)


# ---- タイトル ----
fnt_t = f(S(52), True)
bbox = d.textbbox((0, 0), title, font=fnt_t)
d.text((S(W // 2) - (bbox[2] - bbox[0]) // 2, S(36)), title, font=fnt_t, fill=FOREST)

# ---- 表彰台 ----
# 表示順: 左=2位 / 中央=1位 / 右=3位
SLOTS = {2: 0, 1: 1, 3: 2}
BLOCK_SPECS = {
    1: {"height": 190, "color": FOREST_DK, "avatar": 155},
    2: {"height": 140, "color": FOREST, "avatar": 130},
    3: {"height": 95, "color": FOREST, "avatar": 130},
}

BLOCK_W = 280
GAP = 24
BASE_Y = H - 60
total_w = BLOCK_W * 3 + GAP * 2
start_x = (W - total_w) // 2

# 台の影（地面ラインの代わりに、各ブロックの足元へ薄い楕円）
for rank, slot in SLOTS.items():
    sx = start_x + slot * (BLOCK_W + GAP)
    d.ellipse([S(sx - 14), S(BASE_Y - 8), S(sx + BLOCK_W + 14), S(BASE_Y + 14)],
              fill=(230, 222, 210))


def circle_avatar(im: Image.Image, size_px: int) -> Image.Image:
    im = im.resize((size_px, size_px), Image.LANCZOS)
    mask = Image.new("L", (size_px, size_px), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([0, 0, size_px, size_px], fill=255)
    out = Image.new("RGBA", (size_px, size_px), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


for r in top3:
    rank = r["position"]
    name = r["displayName"]
    spec = BLOCK_SPECS[rank]
    ring = RANK_COLORS[rank]
    bh = spec["height"]
    bx = start_x + SLOTS[rank] * (BLOCK_W + GAP)
    bt = BASE_Y - bh  # ブロック上端

    # ブロック
    d.rounded_rectangle([S(bx), S(bt), S(bx + BLOCK_W), S(BASE_Y)],
                        radius=S(10), fill=spec["color"])
    # 上面のハイライト
    d.rounded_rectangle([S(bx), S(bt), S(bx + BLOCK_W), S(bt + 14)],
                        radius=S(10), fill=tuple(min(255, c + 25) for c in spec["color"]))

    # ブロック面の順位表示（1st / 2nd / 3rd）
    rank_label = RANK_LABELS[rank]
    fnt_r = f(S(56), True)
    bbox = d.textbbox((0, 0), rank_label, font=fnt_r)
    rx = S(bx + BLOCK_W // 2) - (bbox[2] - bbox[0]) // 2
    ry = S(bt + bh // 2) - (bbox[3] - bbox[1]) // 2 - bbox[1]
    d.text((rx, ry), rank_label, font=fnt_r, fill=ring)

    # アバター（名前＋プライズ額の2行分を確保）
    av_size = spec["avatar"]
    ax = bx + (BLOCK_W - av_size) // 2
    name_h = 80
    ay = bt - name_h - av_size - 18

    # リング（メダル色）と白フチ
    ring_w = 7
    d.ellipse([S(ax - ring_w), S(ay - ring_w),
               S(ax + av_size + ring_w), S(ay + av_size + ring_w)], fill=ring)
    d.ellipse([S(ax - 2), S(ay - 2), S(ax + av_size + 2), S(ay + av_size + 2)],
              fill=CARD_BG)
    src = load_avatar(r["avatarUrl"]) or silhouette_avatar(S(av_size))
    av = circle_avatar(src, S(av_size))
    img.paste(av, (S(ax), S(ay)), av)

    # 1位に王冠と飾りライン
    if rank == 1:
        cw, ch = 76, 54
        cx = bx + BLOCK_W // 2 - cw // 2
        cy = ay - ch - 14
        ly = cy + 14
        d.line([S(cx - 110), S(ly), S(cx - 30), S(ly)], fill=GOLD, width=S(2))
        d.line([S(cx + cw + 30), S(ly), S(cx + cw + 110), S(ly)], fill=GOLD, width=S(2))
        pts = [
            (cx, cy + ch), (cx, cy + 14),
            (cx + cw * 0.25, cy + ch * 0.52), (cx + cw * 0.5, cy),
            (cx + cw * 0.75, cy + ch * 0.52), (cx + cw, cy + 14),
            (cx + cw, cy + ch),
        ]
        d.polygon([(S(x), S(y)) for x, y in pts], fill=GOLD)
        d.rounded_rectangle([S(cx), S(cy + ch), S(cx + cw), S(cy + ch + 10)],
                            radius=S(3), fill=(190, 150, 40))

    # 名前とプライズ額（アバターとブロックの間に2行）
    fnt_n = f(S(30 if rank == 1 else 27), True)
    label = name
    bbox = d.textbbox((0, 0), label, font=fnt_n)
    nx = S(bx + BLOCK_W // 2) - (bbox[2] - bbox[0]) // 2
    ny = S(ay + av_size + 12)
    d.text((nx, ny), label, font=fnt_n, fill=TEXT)

    prize = r.get("prize") or 0
    if prize > 0:
        fnt_p = f(S(26), True)
        prize_label = f"{prize:,}"
        bbox = d.textbbox((0, 0), prize_label, font=fnt_p)
        px = S(bx + BLOCK_W // 2) - (bbox[2] - bbox[0]) // 2
        d.text((px, ny + S(38)), prize_label, font=fnt_p, fill=FOREST)

# ---- フッター ----
footer = "#BabyPLO"
fnt_f = f(S(24), True)
bbox = d.textbbox((0, 0), footer, font=fnt_f)
d.text((S(W - 40) - (bbox[2] - bbox[0]), S(H - 44)), footer, font=fnt_f, fill=SUB_TEXT)

img = img.resize((W, H), Image.LANCZOS)
img.save(OUT_PATH)
print(f"saved: {OUT_PATH}")
