import { FLAT_ROOF_DEGREES } from './geometry';
import { insidePolygon, type KeepOutZone } from './keep-out';
import { planeHeight, type RoofFace, type Vec3 } from './roof-faces';

// Aerial imagery in the scene frame: RGBA rows from north (minZ) to south,
// columns from west (minX) to east.
export type SceneImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

// A trained model's obstacle probability for each pixel of a SceneImage.
export type ObstacleProbability = { data: Float32Array; threshold: number };

// Only roofs big enough to hold an array are searched.
const MIN_FACE_AREA = 25;
// Edges are skipped: parapets, their shadows and a meter of misregistration.
const EDGE_METERS = 0.6;
// Stats come from deeper inside, where the bare membrane dominates.
const STATS_EDGE_METERS = 1.2;
// How far a pixel must stray from the roof's usual color, in robust standard
// deviations, with floors for very uniform roofs.
const SPREAD = 3.2;
const MIN_LIGHT_STEP = 26;
const MIN_COLOR_STEP = 20;
// Pieces of one object (a unit and its shadow) closer than this are merged.
const MERGE_METERS = 0.35;
const MIN_AREA = 0.3;
const MAX_AREA = 80;
// A larger share of one roof is a shadow or a repaired patch, not equipment.
const MAX_FACE_SHARE = 0.12;
const MIN_WIDTH = 0.35;
// Objects fill most of their rectangle; L-shaped strays along walls do not.
const MIN_FILL = 0.35;
// Long, mostly dark strips are shadows of walls and higher roofs.
const SHADOW_ASPECT = 3.5;
const SHADOW_DARK_SHARE = 0.6;
// Margin added around each object's rectangle.
const MARGIN_METERS = 0.15;
const MAX_ZONES = 40;
// The model tells equipment from shadows and patches by itself, so it may
// report larger plant on a roof than the color rule dares to.
const MODEL_MAX_AREA = 150;
const MODEL_MAX_FACE_SHARE = 0.4;

type Point = [number, number];

// Obstacles on flat roofs: HVAC units, bulkheads, skylights, hatches. With a
// model's probabilities they are the pixels it marks; without, the areas whose
// color stands out from the bare roof around them. Each comes back as a
// rectangle on the roof, in the order of size.
export function detectObstacles(image: SceneImage, faces: RoofFace[], existing: KeepOutZone[] = [], probability?: ObstacleProbability): Vec3[][] {
  const { width, height, data } = image;
  const sx = (image.maxX - image.minX) / width;
  const sz = (image.maxZ - image.minZ) / height;
  const pixelArea = sx * sz;
  const toPixel = (x: number, z: number): Point => [(x - image.minX) / sx - 0.5, (z - image.minZ) / sz - 0.5];
  const toScene = (column: number, row: number): Point => [image.minX + (column + 0.5) * sx, image.minZ + (row + 0.5) * sz];
  const existingRings = existing.map((zone) => zone.points.map(([x, , z]) => [x, z] as const));
  const found: Array<{ points: Vec3[]; area: number }> = [];

  faces.forEach((face) => {
    if (face.slopeDegrees >= FLAT_ROOF_DEGREES || face.areaSquareMeters < MIN_FACE_AREA) return;
    // The face's pixels, within a bounding box of the image.
    let left = width, top = height, right = -1, bottom = -1;
    for (const triangle of face.triangles) {
      for (const [x, , z] of triangle) {
        const [c, r] = toPixel(x, z);
        left = Math.min(left, Math.floor(c)); right = Math.max(right, Math.ceil(c));
        top = Math.min(top, Math.floor(r)); bottom = Math.max(bottom, Math.ceil(r));
      }
    }
    left = Math.max(0, left); top = Math.max(0, top);
    right = Math.min(width - 1, right); bottom = Math.min(height - 1, bottom);
    const w = right - left + 1;
    const h = bottom - top + 1;
    if (w < 4 || h < 4) return;
    const mask = new Uint8Array(w * h);
    for (const triangle of face.triangles) fillTriangle(mask, w, h, triangle.map(([x, , z]) => {
      const [c, r] = toPixel(x, z);
      return [c - left, r - top] as Point;
    }));

    const inner = erode(mask, w, h, Math.round(EDGE_METERS / sx));
    const marked = probability
      ? markedByModel(probability, inner, w, h, left, top, width)
      : markedByColor(data, mask, inner, w, h, left, top, width, sx, pixelArea);
    if (!marked) return;
    let odd = marked.odd;
    // Drop speckle, then join a unit to its shadow and nearby parts.
    odd = dilate(erode(odd, w, h, 1), w, h, 1);
    const merge = Math.max(1, Math.round(MERGE_METERS / sx));
    odd = erode(dilate(odd, w, h, merge), w, h, merge);
    for (let index = 0; index < odd.length; index += 1) odd[index] &= inner[index];

    const faceLimit = probability
      ? Math.min(MODEL_MAX_AREA, face.areaSquareMeters * MODEL_MAX_FACE_SHARE)
      : Math.min(MAX_AREA, face.areaSquareMeters * MAX_FACE_SHARE);
    for (const pixels of components(odd, w)) {
      const area = pixels.length * pixelArea;
      if (area < MIN_AREA || area > faceLimit) continue;
      const corners: Point[] = [];
      for (const index of pixels) {
        const column = left + (index % w);
        const row = top + Math.floor(index / w);
        for (const [dc, dr] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) corners.push(toScene(column + dc, row + dr));
      }
      const rectangle = minAreaRectangle(convexHull(corners), MARGIN_METERS);
      if (!rectangle || rectangle.shortSide < MIN_WIDTH || area / (rectangle.shortSide * rectangle.longSide) < MIN_FILL) continue;
      if (rectangle.longSide / rectangle.shortSide > SHADOW_ASPECT && marked.darkShare(pixels) > SHADOW_DARK_SHARE) continue;
      const [cx, cz] = rectangle.points.reduce(([ax, az], [x, z]) => [ax + x / 4, az + z / 4], [0, 0]);
      if (existingRings.some((ring) => insidePolygon(cx, cz, ring))) continue;
      found.push({ area, points: rectangle.points.map(([x, z]) => [x, planeHeight(face, x, z), z] as Vec3) });
    }
  });

  return found.sort((a, b) => b.area - a.area).slice(0, MAX_ZONES).map((item) => item.points);
}

type Marked = { odd: Uint8Array; darkShare: (pixels: number[]) => number };

// Pixels the model gives at least its threshold. It already tells shadows
// from objects, so no strip counts as a shadow.
function markedByModel(probability: ObstacleProbability, inner: Uint8Array, w: number, h: number, left: number, top: number, width: number): Marked {
  const odd = new Uint8Array(w * h);
  for (let row = 0; row < h; row += 1) {
    for (let column = 0; column < w; column += 1) {
      const index = row * w + column;
      if (inner[index] && probability.data[(top + row) * width + left + column] >= probability.threshold) odd[index] = 1;
    }
  }
  return { odd, darkShare: () => 0 };
}

// Pixels whose lightness or color strays from the roof's usual membrane, or
// null when too little bare roof shows to learn that color from.
function markedByColor(data: Uint8ClampedArray, mask: Uint8Array, inner: Uint8Array, w: number, h: number, left: number, top: number, width: number, sx: number, pixelArea: number): Marked | null {
  const core = erode(mask, w, h, Math.round(STATS_EDGE_METERS / sx));
  const light = new Float32Array(w * h);
  const warm = new Float32Array(w * h);
  const blue = new Float32Array(w * h);
  for (let row = 0; row < h; row += 1) {
    for (let column = 0; column < w; column += 1) {
      const at = ((top + row) * width + left + column) * 4;
      const [red, green, b] = [data[at], data[at + 1], data[at + 2]];
      const index = row * w + column;
      light[index] = 0.299 * red + 0.587 * green + 0.114 * b;
      warm[index] = red - green;
      blue[index] = (red + green) / 2 - b;
    }
  }
  const sample = (values: Float32Array) => {
    const picked: number[] = [];
    for (let index = 0; index < values.length; index += 1) if (core[index]) picked.push(values[index]);
    return picked;
  };
  const lightValues = sample(light);
  if (lightValues.length * pixelArea < MIN_FACE_AREA / 2) return null;
  const [lightMid, lightSpread] = robust(lightValues);
  const [warmMid, warmSpread] = robust(sample(warm));
  const [blueMid, blueSpread] = robust(sample(blue));
  const lightStep = Math.max(MIN_LIGHT_STEP, SPREAD * lightSpread);
  const colorStep = Math.max(MIN_COLOR_STEP, SPREAD * Math.hypot(warmSpread, blueSpread));
  const odd = new Uint8Array(w * h);
  for (let index = 0; index < odd.length; index += 1) {
    if (!inner[index]) continue;
    const color = Math.hypot(warm[index] - warmMid, blue[index] - blueMid);
    if (Math.abs(light[index] - lightMid) > lightStep || color > colorStep) odd[index] = 1;
  }
  return {
    odd,
    darkShare: (pixels) => pixels.reduce((count, index) => count + (light[index] < lightMid - lightStep ? 1 : 0), 0) / pixels.length,
  };
}

// Median and a robust standard deviation (1.4826 × median absolute deviation).
function robust(values: number[]): [number, number] {
  if (!values.length) return [0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  return [median, 1.4826 * deviations[Math.floor(deviations.length / 2)]];
}

// Marks the pixels whose centers fall inside a triangle given in pixel units.
function fillTriangle(mask: Uint8Array, w: number, h: number, [a, b, c]: Point[]) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(area) < 1e-9) return;
  const minC = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxC = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minR = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxR = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let row = minR; row <= maxR; row += 1) {
    for (let column = minC; column <= maxC; column += 1) {
      const u = ((b[0] - column) * (c[1] - row) - (c[0] - column) * (b[1] - row)) / area;
      const v = ((c[0] - column) * (a[1] - row) - (a[0] - column) * (c[1] - row)) / area;
      if (u >= 0 && v >= 0 && u + v <= 1) mask[row * w + column] = 1;
    }
  }
}

// Square-window morphology via running sums along rows, then columns.
function boxCount(mask: Uint8Array, w: number, h: number, radius: number): Uint16Array {
  const rows = new Uint16Array(w * h);
  for (let row = 0; row < h; row += 1) {
    let sum = 0;
    for (let column = -radius; column < w; column += 1) {
      const enter = column + radius;
      if (enter < w) sum += mask[row * w + enter];
      const leave = column - radius - 1;
      if (leave >= 0) sum -= mask[row * w + leave];
      if (column >= 0) rows[row * w + column] = sum;
    }
  }
  const counts = new Uint16Array(w * h);
  for (let column = 0; column < w; column += 1) {
    let sum = 0;
    for (let row = -radius; row < h; row += 1) {
      const enter = row + radius;
      if (enter < h) sum += rows[enter * w + column];
      const leave = row - radius - 1;
      if (leave >= 0) sum -= rows[leave * w + column];
      if (row >= 0) counts[row * w + column] = sum;
    }
  }
  return counts;
}

// Outside the image counts as background, so erosion also trims image edges.
function erode(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice();
  const counts = boxCount(mask, w, h, radius);
  const full = (2 * radius + 1) ** 2;
  return mask.map((value, index) => (value && counts[index] === full ? 1 : 0));
}

function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice();
  const counts = boxCount(mask, w, h, radius);
  return mask.map((_, index) => (counts[index] > 0 ? 1 : 0));
}

// 4-connected groups of set pixels.
function components(mask: Uint8Array, w: number): number[][] {
  const seen = new Uint8Array(mask.length);
  const groups: number[][] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const group: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const index = stack.pop()!;
      group.push(index);
      const column = index % w;
      for (const next of [index - w, index + w, column > 0 ? index - 1 : -1, column < w - 1 ? index + 1 : -1]) {
        if (next < 0 || next >= mask.length || !mask[next] || seen[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    groups.push(group);
  }
  return groups;
}

// Andrew's monotone chain.
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list: Point[]) => {
    const hull: Point[] = [];
    for (const point of list) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    hull.pop();
    return hull;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}

// The smallest rectangle around a convex hull has a side along one of its
// edges; it comes back grown by `margin` on every side.
export function minAreaRectangle(hull: Point[], margin = 0): { points: Point[]; shortSide: number; longSide: number } | null {
  if (hull.length < 3) return null;
  let best: { area: number; angle: number; box: [number, number, number, number] } | null = null;
  for (let i = 0; i < hull.length; i += 1) {
    const [ax, az] = hull[i];
    const [bx, bz] = hull[(i + 1) % hull.length];
    const angle = Math.atan2(bz - az, bx - ax);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of hull) {
      const u = x * cos + z * sin;
      const v = -x * sin + z * cos;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, angle, box: [minU - margin, maxU + margin, minV - margin, maxV + margin] };
  }
  const { angle, box: [minU, maxU, minV, maxV] } = best!;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const back = (u: number, v: number): Point => [u * cos - v * sin, u * sin + v * cos];
  return {
    points: [back(minU, minV), back(maxU, minV), back(maxU, maxV), back(minU, maxV)],
    shortSide: Math.min(maxU - minU, maxV - minV) - 2 * margin,
    longSide: Math.max(maxU - minU, maxV - minV) - 2 * margin,
  };
}
