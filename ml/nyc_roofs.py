"""Shared helpers for the rooftop obstacle dataset: LiDAR tiles, building
footprints, aerial imagery and the LiDAR-derived obstacle labels.

Everything works in NAD83(2011) / UTM 18N (EPSG:6347), the LiDAR's own grid.
"""
from __future__ import annotations

import csv
import io
import re
import sqlite3
import struct
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import laspy
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from scipy import ndimage

LIDAR_URL = 'https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/laz/geoid18/9306'
ORTHO_URL = 'https://orthos.its.ny.gov/arcgis/rest/services/wms/{year}/MapServer/export'
UTM = 6347
TO_UTM = Transformer.from_crs(4326, UTM, always_xy=True)
TO_WGS84 = Transformer.from_crs(UTM, 4326, always_xy=True)

# Image pixels, matching the app's ~15 cm basemap.
PIXEL = 0.15
# LiDAR surface cells: about one point per cell at 13 points/m².
DSM_CELL = 0.3
# Objects narrower than twice this stick out of the morphological opening;
# larger roof levels survive it and are not labeled.
OPENING_RADIUS = 4.0
# How far above the surrounding roof a point must rise to be an obstacle.
MIN_RISE = 0.45
# Roof edges are left out: parapets and a little misregistration.
EDGE = 0.6
MIN_OBJECT_AREA = 0.3
# Bigger raised areas are whole roof levels (a taller row house next door),
# not equipment; they are left out of training rather than labeled.
MAX_OBJECT_AREA = 45
# Only flat roofs are labeled, like the app only searches flat faces: a
# building counts when most of its roof slopes less than this.
FLAT_DEGREES = 8
FLAT_SHARE = 0.7
# Near a step between roof levels (or a shared wall) the label is unreliable
# and left out of training.
STEP_RISE = 0.8
STEP_RADIUS = 1.0


@dataclass
class Tile:
    name: str
    min_x: float
    max_x: float
    min_y: float
    max_y: float


def lidar_tiles(raw: Path) -> list[Tile]:
    """Tile bounds from NOAA's min/max table (downloaded once)."""
    path = raw / 'minmax.csv'
    if not path.exists():
        download(f'{LIDAR_URL}/minmax_2017_nyc_topobathy_m9306.csv', path)
    tiles = []
    for row in csv.reader(open(path)):
        if row[0] == 'Filename':
            continue
        values = [float(v) for v in re.findall(r'-?\d+\.\d+', ','.join(row[1:]))]
        tiles.append(Tile(row[0].strip(), values[0], values[1], values[2], values[3]))
    return tiles


def download(url: str, path: Path, attempts: int = 4) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(attempts):
        try:
            partial = path.with_suffix(path.suffix + '.part')
            urllib.request.urlretrieve(url, partial)
            partial.replace(path)
            return
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 * (attempt + 1))


def lidar_points(raw: Path, tile: Tile) -> np.ndarray:
    """Non-ground returns of a tile as an (n, 3) array."""
    path = raw / tile.name
    if not path.exists():
        download(f'{LIDAR_URL}/{tile.name}', path)
    las = laspy.read(path)
    keep = np.asarray(las.classification) != 2
    return np.column_stack([las.x[keep], las.y[keep], las.z[keep]])


def footprints(database: Path, bounds: tuple[float, float, float, float]) -> list[list[np.ndarray]]:
    """Building ground rings (UTM) whose boxes touch `bounds` (UTM)."""
    min_x, min_y, max_x, max_y = bounds
    lngs, lats = TO_WGS84.transform([min_x, max_x, min_x, max_x], [min_y, min_y, max_y, max_y])
    connection = sqlite3.connect(database)
    rows = connection.execute(
        'SELECT f.rings FROM footprint_bounds b JOIN footprints f ON f.id = b.id '
        'WHERE b.max_lng >= ? AND b.min_lng <= ? AND b.max_lat >= ? AND b.min_lat <= ?',
        (min(lngs), max(lngs), min(lats), max(lats)),
    ).fetchall()
    buildings = []
    for (blob,) in rows:
        values = struct.unpack(f'<{len(blob) // 4}i', blob)
        rings, at = [], 1
        for _ in range(values[0]):
            count = values[at]
            flat = np.array(values[at + 1: at + 1 + 2 * count], dtype=np.float64) / 1e7
            at += 1 + 2 * count
            x, y = TO_UTM.transform(flat[0::2], flat[1::2])
            rings.append(np.column_stack([x, y]))
        buildings.append(rings)
    return buildings


def ortho(year: str, bounds: tuple[float, float, float, float], size: int) -> np.ndarray:
    """NYS orthoimagery for a square UTM box as an RGB array, north up."""
    min_x, min_y, max_x, max_y = bounds
    url = (f'{ORTHO_URL.format(year=year)}?bbox={min_x},{min_y},{max_x},{max_y}'
           f'&bboxSR={UTM}&imageSR={UTM}&size={size},{size}&format=png24&f=image')
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return np.asarray(Image.open(io.BytesIO(response.read())).convert('RGB'))
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError('unreachable')


def rasterize(rings_list: list[list[np.ndarray]], bounds, cell: float, shape: tuple[int, int]) -> np.ndarray:
    """Building numbers (1-based, 0 outside) on a north-up grid (row 0 at max_y)."""
    min_x, _, _, max_y = bounds
    image = Image.new('I', (shape[1], shape[0]), 0)
    draw = ImageDraw.Draw(image)
    for number, rings in enumerate(rings_list, start=1):
        for ring in rings:
            columns = (ring[:, 0] - min_x) / cell
            rows = (max_y - ring[:, 1]) / cell
            draw.polygon(list(zip(columns, rows)), fill=number)
    return np.asarray(image, dtype=np.int32)


def disk(radius_cells: float) -> np.ndarray:
    r = int(np.ceil(radius_cells))
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= radius_cells * radius_cells


def obstacle_label(points: np.ndarray, buildings: np.ndarray, bounds, size: int) -> tuple[np.ndarray, np.ndarray]:
    """Obstacle mask and valid (labeled) mask at image resolution.

    The roof surface is the highest return per cell inside building
    footprints; obstacles are what rises above its morphological opening.
    Pitched roofs, roof edges and steps between levels are not valid.
    """
    min_x, min_y, max_x, max_y = bounds
    cells = int(round((max_x - min_x) / DSM_CELL))
    inside = (points[:, 0] >= min_x) & (points[:, 0] < max_x) & (points[:, 1] >= min_y) & (points[:, 1] < max_y)
    p = points[inside]
    columns = ((p[:, 0] - min_x) / DSM_CELL).astype(int)
    rows = ((max_y - p[:, 1]) / DSM_CELL).astype(int)
    surface = np.full((cells, cells), -np.inf)
    np.maximum.at(surface, (rows, columns), p[:, 2])
    numbers = resize_nearest(buildings, cells)
    roof_cells = numbers > 0
    # Fill cells without a return from their neighbors.
    empty = ~np.isfinite(surface)
    if empty.all():
        zero = np.zeros((size, size), bool)
        return zero, zero
    nearest = ndimage.distance_transform_edt(empty, return_distances=False, return_indices=True)
    surface = surface[tuple(nearest)]
    # The roof each obstacle rises from, per building: outside its footprint
    # (the street, a lower or taller neighbor) counts as high, so the opening
    # only sees this building's own roof. Square windows are separable.
    window = 2 * int(OPENING_RADIUS / DSM_CELL) + 1
    pad = window
    opened = surface.copy()
    for number, box in enumerate(ndimage.find_objects(numbers), start=1):
        if box is None:
            continue
        rows_, columns_ = box
        padded = (slice(max(0, rows_.start - pad), rows_.stop + pad), slice(max(0, columns_.start - pad), columns_.stop + pad))
        own = numbers[padded] == number
        local = surface[padded]
        work = np.where(own, local, local[own].max() + 50)
        opened[padded][own] = ndimage.grey_opening(work, size=window)[own]
    inner = ndimage.binary_erosion(roof_cells, structure=disk(EDGE / DSM_CELL))
    # Flat buildings: most of the smoothed roof slopes gently.
    smooth = ndimage.median_filter(surface, size=5)
    gy, gx = np.gradient(smooth, DSM_CELL)
    flat = np.degrees(np.arctan(np.hypot(gx, gy))) < FLAT_DEGREES
    count = int(numbers.max())
    with np.errstate(invalid='ignore'):
        share = np.nan_to_num(ndimage.mean(flat, numbers, range(1, count + 1))) if count else np.array([])
    flat_buildings = np.concatenate([[False], np.asarray(share) >= FLAT_SHARE])
    # Steps between roof levels, seen in the opened (obstacle-free) surface.
    window = 2 * int(STEP_RADIUS / DSM_CELL) + 1
    step = (ndimage.grey_dilation(opened, size=window) - ndimage.grey_erosion(opened, size=window)) > STEP_RISE
    valid = inner & flat_buildings[numbers] & ~step
    rise = surface - opened
    raised = valid & (rise > MIN_RISE) & (rise < 15)
    raised = ndimage.binary_opening(raised, structure=np.ones((2, 2)))
    labels, count = ndimage.label(raised)
    if count:
        areas = np.asarray(ndimage.sum(raised, labels, range(1, count + 1))) * DSM_CELL * DSM_CELL
        too_big = np.isin(labels, np.nonzero(areas > MAX_OBJECT_AREA)[0] + 1)
        valid &= ~ndimage.binary_dilation(too_big, iterations=2)
        raised = np.isin(labels, np.nonzero((areas >= MIN_OBJECT_AREA) & (areas <= MAX_OBJECT_AREA))[0] + 1)
    return resize_nearest(raised, size) > 0, resize_nearest(valid, size) > 0


def resize_nearest(grid: np.ndarray, size: int) -> np.ndarray:
    mode = 'I' if grid.dtype != bool else 'L'
    values = grid.astype(np.int32) if mode == 'I' else grid.astype(np.uint8) * 255
    return np.asarray(Image.fromarray(values, mode=mode).resize((size, size), Image.NEAREST))
