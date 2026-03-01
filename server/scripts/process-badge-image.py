#!/usr/bin/env python3
"""
バッジ元画像をアイコン用に加工するスクリプト

使い方:
  python3 server/scripts/process-badge-image.py <元画像> <出力名>

例:
  python3 server/scripts/process-badge-image.py public/images/badges/source.png penguin
  → public/images/badges/penguin.png (256x256)
  → public/images/badges/penguin@2x.png (512x512)
"""
import sys
import os
from PIL import Image, ImageDraw

def find_circle_bounds(img, threshold=50):
    """画像中の円形バッジの境界を検出"""
    pixels = img.load()
    w, h = img.size

    # 水平スキャン（中央行）
    cy = h // 2
    first_h = last_h = None
    for x in range(w):
        r, g, b = pixels[x, cy][:3]
        if (r + g + b) / 3 > threshold:
            if first_h is None: first_h = x
            last_h = x

    # 垂直スキャン（中央列）
    cx = w // 2
    first_v = last_v = None
    for y in range(h):
        r, g, b = pixels[cx, y][:3]
        if (r + g + b) / 3 > threshold:
            if first_v is None: first_v = y
            last_v = y

    center_x = (first_h + last_h) // 2
    center_y = (first_v + last_v) // 2
    radius = max((last_h - first_h) // 2, (last_v - first_v) // 2) + 5
    return center_x, center_y, radius

def process_badge(src_path, output_name):
    img = Image.open(src_path)
    w, h = img.size
    print(f"元画像: {w}x{h}")

    # 正方形にクロップ（高さベース、中央）
    square_size = h
    left = (w - square_size) // 2
    cropped = img.crop((left, 0, left + square_size, square_size))

    # 円の検出
    cx, cy, radius = find_circle_bounds(cropped)
    print(f"円検出: center=({cx},{cy}), radius={radius}")

    # タイトクロップ
    crop_l = max(0, cx - radius)
    crop_t = max(0, cy - radius)
    crop_r = min(square_size, cx + radius)
    crop_b = min(square_size, cy + radius)
    tight = cropped.crop((crop_l, crop_t, crop_r, crop_b))

    # 正方形に整形
    tw, th = tight.size
    max_dim = max(tw, th)
    square_img = Image.new("RGBA", (max_dim, max_dim), (0, 0, 0, 0))
    square_img.paste(tight, ((max_dim - tw) // 2, (max_dim - th) // 2))

    # 円形マスク
    mask = Image.new("L", (max_dim, max_dim), 0)
    draw = ImageDraw.Draw(mask)
    margin = 8
    draw.ellipse([margin, margin, max_dim - margin, max_dim - margin], fill=255)
    square_img.putalpha(mask)

    # 出力
    out_dir = os.path.dirname(src_path)
    path_1x = os.path.join(out_dir, f"{output_name}.png")
    path_2x = os.path.join(out_dir, f"{output_name}@2x.png")

    square_img.resize((256, 256), Image.LANCZOS).save(path_1x, "PNG", optimize=True)
    square_img.resize((512, 512), Image.LANCZOS).save(path_2x, "PNG", optimize=True)

    for p in [path_1x, path_2x]:
        kb = os.path.getsize(p) // 1024
        print(f"  {os.path.basename(p)}: {kb}KB")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    src, name = sys.argv[1], sys.argv[2]
    if not os.path.exists(src):
        print(f"Error: {src} not found")
        sys.exit(1)

    process_badge(src, name)
    print("Done!")
