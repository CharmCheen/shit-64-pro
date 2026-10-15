# 11_sticker_sheets.py — 把命名范围内的表情包渲染成 contact sheet（GIF/WEBP 取首帧+中帧）
# 用法: python scripts/11_sticker_sheets.py
# 输入: output/sticker_manifest.json
# 输出: output/sticker_sheets/sheet_NN.png（透明底用棋盘格衬底，白字贴纸不会隐形）

import json
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'output', 'sticker_manifest.json')
OUTDIR = os.path.join(ROOT, 'output', 'sticker_sheets')

COLS, ROWS = 5, 6
CELL = 200          # 图像区边长
LABEL_H = 26
GAP = 8
PER_SHEET = COLS * ROWS


def checkerboard(w, h, sq=16):
    bg = Image.new('RGB', (w, h), (255, 255, 255))
    d = ImageDraw.Draw(bg)
    for y in range(0, h, sq):
        for x in range(0, w, sq):
            if (x // sq + y // sq) % 2:
                d.rectangle([x, y, x + sq - 1, y + sq - 1], fill=(225, 225, 225))
    return bg


def load_frames(path):
    im = Image.open(path)
    n = getattr(im, 'n_frames', 1)
    idxs = [0, n // 2] if n > 1 else [0]
    frames = []
    for i in idxs:
        im.seek(i)
        frames.append(im.convert('RGBA'))
    return frames


def fit(im, w, h):
    r = min(w / im.width, h / im.height)
    return im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.LANCZOS)


def render_cell(item, font):
    cell = Image.new('RGB', (CELL, CELL + LABEL_H), (255, 255, 255))
    d = ImageDraw.Draw(cell)
    try:
        frames = load_frames(item['file'])
    except Exception as e:  # 文件损坏时画占位，不中断整张图
        d.rectangle([0, 0, CELL - 1, CELL - 1], outline=(255, 0, 0))
        d.text((6, 6), 'ERR ' + type(e).__name__, fill=(255, 0, 0), font=font)
        d.text((4, CELL + 4), f"{item['label']} x{item['total']}", fill=(0, 0, 0), font=font)
        return cell

    board = checkerboard(CELL, CELL)
    if len(frames) == 1:
        im = fit(frames[0], CELL, CELL)
        board.paste(im, ((CELL - im.width) // 2, (CELL - im.height) // 2), im)
    else:
        half = (CELL - GAP) // 2
        x = 0
        for f in frames:
            im = fit(f, half, CELL)
            board.paste(im, (x, (CELL - im.height) // 2), im)
            x += half + GAP
    cell.paste(board, (0, 0))

    tag = 'T' if item['target'] > 0 else ' '
    d.text((4, CELL + 5), f"{item['label']} x{item['total']} {tag}", fill=(0, 0, 0), font=font)
    return cell


def main():
    manifest = json.load(open(MANIFEST, encoding='utf-8'))
    named = [s for s in manifest['stickers'] if s['named'] and s['file']]
    font = ImageFont.load_default(16)
    os.makedirs(OUTDIR, exist_ok=True)

    labels = []
    n_sheets = math.ceil(len(named) / PER_SHEET)
    for si in range(n_sheets):
        chunk = named[si * PER_SHEET:(si + 1) * PER_SHEET]
        sheet = Image.new('RGB', (COLS * (CELL + GAP) + GAP, ROWS * (CELL + LABEL_H + GAP) + GAP + 30), (60, 60, 60))
        d = ImageDraw.Draw(sheet)
        d.text((GAP + 4, 8), f"sheet {si + 1}/{n_sheets}  cells {chunk[0]['label']}-{chunk[-1]['label']}  (T=target user)", fill=(255, 255, 0), font=font)
        for k, item in enumerate(chunk):
            r, c = divmod(k, COLS)
            x = GAP + c * (CELL + GAP)
            y = 30 + GAP + r * (CELL + LABEL_H + GAP)
            sheet.paste(render_cell(item, font), (x, y))
            d.rectangle([x - 1, y - 1, x + CELL, y + CELL + LABEL_H - 1], outline=(120, 120, 120))
            labels.append({'label': item['label'], 'md5': item['md5'], 'file': item['file'], 'total': item['total'], 'target': item['target']})
        out = os.path.join(OUTDIR, f'sheet_{si + 1:02d}.png')
        sheet.save(out)
        print(out, sheet.size)

    with open(os.path.join(OUTDIR, 'labels.json'), 'w', encoding='utf-8') as f:
        json.dump(labels, f, ensure_ascii=False, indent=1)
    print(f'{len(named)} cells / {n_sheets} sheets -> {OUTDIR}')


if __name__ == '__main__':
    main()
