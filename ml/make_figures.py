"""Draws the README's method figures into docs/figures.

    ml/.venv/Scripts/python ml/make_figures.py

Needs the dataset (ml/build_dataset.py), the downloaded training run in
data/ml/result/unet (log.csv, previews/, model.fp16.onnx) and network access
for the P.S. 321 imagery and LiDAR tile.
"""
from __future__ import annotations

import csv
import json
import random
import sys
from pathlib import Path

import numpy as np
import onnxruntime
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).parent))
import nyc_roofs as R  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'figures'
RUN = ROOT / 'data' / 'ml' / 'result' / 'unet'
DATASET = ROOT / 'data' / 'ml' / 'dataset'
PS321 = (-73.978344, 40.671682)
RED = np.array([235, 40, 40])
CYAN = (0, 230, 255)


def font(size: int):
    for name in ('msyh.ttc', 'arial.ttf', 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def caption(image: Image.Image, text: str) -> Image.Image:
    """A strip with a label above the image."""
    strip = Image.new('RGB', (image.width, 44), (255, 255, 255))
    ImageDraw.Draw(strip).text((14, 9), text, fill=(30, 30, 30), font=font(22))
    out = Image.new('RGB', (image.width, image.height + strip.height), (255, 255, 255))
    out.paste(strip, (0, 0))
    out.paste(image, (0, strip.height))
    return out


def row(images: list[Image.Image], gap: int = 12) -> Image.Image:
    width = sum(i.width for i in images) + gap * (len(images) - 1)
    out = Image.new('RGB', (width, max(i.height for i in images)), (255, 255, 255))
    x = 0
    for image in images:
        out.paste(image, (x, 0))
        x += image.width + gap
    return out


def overlay(rgb: np.ndarray, mask: np.ndarray, valid: np.ndarray | None = None) -> np.ndarray:
    image = rgb.astype(float)
    if valid is not None:
        image[~valid & ~mask] *= 0.55
    image[mask] = image[mask] * 0.35 + RED * 0.65
    return image.clip(0, 255).astype(np.uint8)


def outline(image: np.ndarray, mask: np.ndarray, color=CYAN) -> np.ndarray:
    image = image.copy()
    edge = mask & ~ndimage.binary_erosion(mask, iterations=2)
    image[edge] = color
    return image


def ps321_triptych(session, meta) -> None:
    """Aerial image, LiDAR label and model prediction for P.S. 321."""
    x, y = R.TO_UTM.transform(*PS321)
    half = 48
    bounds = (x - half, y - half, x + half, y + half)
    size = 640
    rgb = R.ortho('2014', bounds, size)
    raw = ROOT / 'data' / 'raw' / 'lidar'
    tile = next(t for t in R.lidar_tiles(raw) if t.min_x <= x <= t.max_x and t.min_y <= y <= t.max_y)
    buildings = R.rasterize(R.footprints(ROOT / 'data/processed/nyc-footprints.sqlite', bounds), bounds, R.PIXEL, (size, size))
    label, valid = R.obstacle_label(R.lidar_points(raw, tile), buildings, bounds, size)
    probability = predict(session, meta, rgb)
    roofs = ndimage.binary_erosion(buildings > 0, iterations=4)
    predicted = (probability >= meta['threshold']) & roofs
    model = rgb.astype(float)
    model[~roofs] *= 0.55
    model[predicted] = model[predicted] * 0.35 + RED * 0.65
    model = outline(model.clip(0, 255).astype(np.uint8), predicted, (255, 230, 0))
    panels = [
        caption(Image.fromarray(rgb), '1 · 2014 aerial imagery (15 cm)'),
        caption(Image.fromarray(overlay(rgb, label, valid)), '2 · LiDAR label: rises ≥ 0.45 m'),
        caption(Image.fromarray(model), '3 · U-Net prediction (threshold 0.4)'),
    ]
    row(panels).save(OUT / 'ps321-label-prediction.jpg', quality=88)


def predict(session, meta, rgb: np.ndarray) -> np.ndarray:
    mean = np.array(meta['input']['mean'], np.float32)
    std = np.array(meta['input']['std'], np.float32)
    image = (rgb.astype(np.float32) / 255 - mean) / std
    return session.run(None, {'image': image.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]


def training_samples() -> None:
    """Training chips from different neighborhoods with their LiDAR labels."""
    splits = json.loads((DATASET / 'splits.json').read_text())
    names = splits['train']
    random.Random(5).shuffle(names)
    picked = []
    for name in names:
        mask = np.asarray(Image.open(DATASET / 'masks' / f'{name}.png'))
        if (mask == 2).mean() > 0.01 and (mask > 0).mean() > 0.3:
            picked.append((name, mask))
        if len(picked) == 4:
            break
    tiles = []
    for (name, mask), year in zip(picked, ['2014', '2016', '2018', '2014']):
        rgb = np.asarray(Image.open(DATASET / 'images' / f'{name}_{year}.jpg').convert('RGB'))
        image = Image.fromarray(overlay(rgb, mask == 2, mask > 0)).resize((380, 380))
        tiles.append(caption(image, f'{year} imagery'))
    row(tiles).save(OUT / 'training-samples.jpg', quality=86)


def test_previews() -> None:
    """Held-out chips: red LiDAR obstacles, cyan predicted outlines."""
    previews = sorted((RUN / 'previews').glob('*.jpg'))
    picks = [previews[i] for i in (2, 15, 36) if i < len(previews)]
    tiles = [caption(Image.open(path).convert('RGB').resize((420, 420)), path.stem) for path in picks]
    row(tiles).save(OUT / 'test-predictions.jpg', quality=86)


def training_curve() -> None:
    """Validation scores per epoch as a small SVG line chart."""
    rows = list(csv.DictReader(open(RUN / 'log.csv')))
    series = [('f1', 'Pixel F1', '#2563eb'), ('object_recall', 'Objects found', '#16a34a'), ('object_precision', 'Objects right', '#ea580c')]
    width, height, left, right, top, bottom = 720, 300, 56, 170, 20, 44
    plot_w, plot_h = width - left - right, height - top - bottom
    epochs = [int(r['epoch']) for r in rows]
    sx = lambda e: left + plot_w * e / max(epochs)
    sy = lambda v: top + plot_h * (1 - v / 0.8)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" font-family="Segoe UI, Arial, sans-serif" font-size="13">',
             f'<rect width="{width}" height="{height}" fill="#ffffff"/>']
    for value in (0, 0.2, 0.4, 0.6, 0.8):
        y = sy(value)
        parts.append(f'<line x1="{left}" x2="{left + plot_w}" y1="{y:.1f}" y2="{y:.1f}" stroke="#e5e7eb"/>')
        parts.append(f'<text x="{left - 8}" y="{y + 4:.1f}" text-anchor="end" fill="#6b7280">{value:.1f}</text>')
    for epoch in range(0, max(epochs) + 1, 10):
        parts.append(f'<text x="{sx(epoch):.1f}" y="{top + plot_h + 18}" text-anchor="middle" fill="#6b7280">{epoch}</text>')
    parts.append(f'<text x="{left + plot_w / 2:.1f}" y="{height - 6}" text-anchor="middle" fill="#374151">Epoch (validation split, threshold 0.5)</text>')
    for index, (key, label, color) in enumerate(series):
        points = ' '.join(f'{sx(int(r["epoch"])):.1f},{sy(float(r[key])):.1f}' for r in rows)
        parts.append(f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="2.2"/>')
        y = top + 20 + index * 24
        parts.append(f'<line x1="{left + plot_w + 18}" x2="{left + plot_w + 40}" y1="{y}" y2="{y}" stroke="{color}" stroke-width="3"/>')
        parts.append(f'<text x="{left + plot_w + 46}" y="{y + 4}" fill="#111827">{label}</text>')
    parts.append('</svg>')
    (OUT / 'training-curve.svg').write_text('\n'.join(parts), encoding='utf8')


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = json.loads((RUN / 'model.json').read_text())
    session = onnxruntime.InferenceSession(str(RUN / 'model.fp16.onnx'), providers=['CPUExecutionProvider'])
    ps321_triptych(session, meta)
    training_samples()
    test_previews()
    training_curve()
    for path in sorted(OUT.iterdir()):
        print(f'{path.relative_to(ROOT)}: {path.stat().st_size / 1e3:.0f} kB')


if __name__ == '__main__':
    main()
