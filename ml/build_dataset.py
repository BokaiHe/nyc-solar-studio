"""Builds the rooftop obstacle dataset: aerial image chips with masks whose
obstacles come from the 2017 NYC LiDAR (see nyc_roofs.obstacle_label).

    python ml/build_dataset.py --tiles 40 --out data/ml/dataset

Output, ready to zip and train on:
    images/{chip}_{year}.jpg   512×512 RGB, 15 cm per pixel, north up
    masks/{chip}.png           0 = ignore, 1 = roof, 2 = obstacle
    splits.json                chips per split, split by LiDAR tile
    meta.json                  settings, for the record

Re-running skips chips already written, so an interrupted build resumes.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import nyc_roofs as R  # noqa: E402

CHIP = 512
# P.S. 321 in Park Slope, the app's tour building, always lands in the test split.
PS321 = (-73.978344, 40.671682)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--tiles', type=int, default=40, help='LiDAR tiles to sample (about 770 m each)')
    parser.add_argument('--years', default='2014,2016,2018', help='Orthoimagery years per chip')
    parser.add_argument('--out', default='data/ml/dataset')
    parser.add_argument('--raw', default='data/raw/lidar')
    parser.add_argument('--footprints', default='data/processed/nyc-footprints.sqlite')
    parser.add_argument('--seed', type=int, default=17)
    parser.add_argument('--min-roof', type=float, default=0.12, help='Least labeled roof share for a chip')
    parser.add_argument('--min-buildings', type=int, default=150, help='Skip LiDAR tiles with fewer buildings (water, parks)')
    parser.add_argument('--workers', type=int, default=6, help='Parallel imagery downloads')
    args = parser.parse_args()

    out, raw = Path(args.out), Path(args.raw)
    (out / 'images').mkdir(parents=True, exist_ok=True)
    (out / 'masks').mkdir(parents=True, exist_ok=True)
    years = args.years.split(',')
    database = Path(args.footprints)

    tiles = R.lidar_tiles(raw)
    random.Random(args.seed).shuffle(tiles)
    x, y = R.TO_UTM.transform(*PS321)
    home = next(t for t in tiles if t.min_x <= x <= t.max_x and t.min_y <= y <= t.max_y)
    tiles.remove(home)
    chosen = [home]
    for tile in tiles:
        if len(chosen) >= args.tiles:
            break
        if len(R.footprints(database, (tile.min_x, tile.min_y, tile.max_x, tile.max_y))) >= args.min_buildings:
            chosen.append(tile)

    # Tiles, not chips, are split, so neighboring chips never straddle splits.
    count = len(chosen)
    test_count = max(1, round(count * 0.1))
    val_count = max(1, round(count * 0.1))
    roles = {chosen[0].name: 'test'}
    for index, tile in enumerate(chosen[1:], start=1):
        roles[tile.name] = 'test' if index < test_count else 'val' if index < test_count + val_count else 'train'

    splits: dict[str, list[str]] = {'train': [], 'val': [], 'test': []}
    stats = {'chips': 0, 'roof_px': 0, 'obstacle_px': 0}
    pool = ThreadPoolExecutor(args.workers)
    for number, tile in enumerate(chosen, start=1):
        stem = tile.name.replace('.copc.laz', '')
        print(f'[{number}/{count}] {stem} ({roles[tile.name]})', flush=True)
        chips = build_tile(tile, raw, database, out, years, args.min_roof, pool)
        for chip, roof_px, obstacle_px in chips:
            splits[roles[tile.name]].append(chip)
            stats['chips'] += 1
            stats['roof_px'] += roof_px
            stats['obstacle_px'] += obstacle_px
        print(f'    {len(chips)} chips', flush=True)

    (out / 'splits.json').write_text(json.dumps(splits, indent=1))
    (out / 'meta.json').write_text(json.dumps({
        'pixel_meters': R.PIXEL, 'chip': CHIP, 'years': years, 'tiles': {t.name: roles[t.name] for t in chosen},
        'label': {'opening_radius': R.OPENING_RADIUS, 'min_rise': R.MIN_RISE, 'edge': R.EDGE, 'dsm_cell': R.DSM_CELL},
        'mask_values': {'ignore': 0, 'roof': 1, 'obstacle': 2},
        'obstacle_share_of_roof': stats['obstacle_px'] / max(1, stats['roof_px'] + stats['obstacle_px']),
        'counts': {name: len(items) for name, items in splits.items()},
    }, indent=1))
    print(json.dumps({name: len(items) for name, items in splits.items()}))


def build_tile(tile: R.Tile, raw: Path, database: Path, out: Path, years: list[str], min_roof: float, pool) -> list[tuple[str, int, int]]:
    stem = tile.name.replace('.copc.laz', '')
    span = CHIP * R.PIXEL
    # Chips on a grid inside the tile, keeping a margin where points run out.
    margin = R.OPENING_RADIUS
    columns = int((tile.max_x - tile.min_x - 2 * margin) // span)
    rows = int((tile.max_y - tile.min_y - 2 * margin) // span)
    origin_x, origin_y = tile.min_x + margin, tile.max_y - margin
    pending = []
    for row in range(rows):
        for column in range(columns):
            chip = f'{stem}_{row:02d}_{column:02d}'
            pending.append((chip, row, column))
    done = [(chip, row, column) for chip, row, column in pending if (out / 'masks' / f'{chip}.png').exists()]
    if len(done) == len(pending) or (out / 'masks' / f'{stem}.empty').exists():
        return [(chip, *mask_stats(out / 'masks' / f'{chip}.png')) for chip, _, _ in done]

    # Label the whole area once, so the opening sees past chip borders.
    bounds = (origin_x - margin, origin_y - rows * span - margin, origin_x + columns * span + margin, origin_y + margin)
    size_x = int(round((bounds[2] - bounds[0]) / R.PIXEL))
    size_y = int(round((bounds[3] - bounds[1]) / R.PIXEL))
    side = max(size_x, size_y)
    square = (bounds[0], bounds[3] - side * R.PIXEL, bounds[0] + side * R.PIXEL, bounds[3])
    points = R.lidar_points(raw, tile)
    rings = R.footprints(database, square)
    buildings = R.rasterize(rings, square, R.PIXEL, (side, side))
    label, valid = R.obstacle_label(points, buildings, square, side)
    offset = int(round(margin / R.PIXEL))

    kept = []
    jobs = []
    for chip, row, column in pending:
        top, left = offset + row * CHIP, offset + column * CHIP
        chip_valid = valid[top:top + CHIP, left:left + CHIP]
        if chip_valid.mean() < min_roof:
            continue
        chip_label = label[top:top + CHIP, left:left + CHIP]
        mask = np.where(chip_label, 2, np.where(chip_valid, 1, 0)).astype(np.uint8)
        chip_bounds = (origin_x + column * span, origin_y - (row + 1) * span, origin_x + (column + 1) * span, origin_y - row * span)
        for year in years:
            jobs.append(pool.submit(fetch_image, out / 'images' / f'{chip}_{year}.jpg', year, chip_bounds))
        kept.append((chip, mask))
    for job in jobs:
        job.result()
    # Masks last: a chip counts as done only once all its images are saved.
    for chip, mask in kept:
        Image.fromarray(mask).save(out / 'masks' / f'{chip}.png')
    kept = [(chip, int((mask == 1).sum()), int((mask == 2).sum())) for chip, mask in kept]
    if not kept:
        (out / 'masks' / f'{stem}.empty').touch()
    return kept


def fetch_image(path: Path, year: str, bounds) -> None:
    if path.exists():
        return
    rgb = R.ortho(year, bounds, CHIP)
    Image.fromarray(rgb).save(path, quality=92)


def mask_stats(path: Path) -> tuple[int, int]:
    mask = np.asarray(Image.open(path))
    return int((mask == 1).sum()), int((mask == 2).sum())


if __name__ == '__main__':
    main()
