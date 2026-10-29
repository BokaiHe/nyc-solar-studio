// Builds src/lib/nyc/coverage.ts: the outline of the area that has NYC / TUM
// 3D building models, traced from the footprint index on a coarse grid.
// Usage: node scripts/build-coverage.mjs [nyc-footprints.sqlite]
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const SOURCE = process.argv[2] ?? 'data/processed/nyc-footprints.sqlite';
const OUTPUT = new URL('../src/lib/nyc/coverage.ts', import.meta.url);
// Grid cell ≈ 200 m at New York's latitude.
const CELL_LAT = 0.0018;
const CELL_LNG = 0.00237;
// Closing radius in cells: fills parks and gaps narrower than ~0.8 km.
const CLOSE_CELLS = 2;
// Drop specks smaller than this many cells (piers, lone outliers).
const MIN_REGION_CELLS = 30;

const db = new DatabaseSync(SOURCE, { readOnly: true });
const rows = db.prepare('SELECT (min_lng + max_lng) / 2 AS lng, (min_lat + max_lat) / 2 AS lat FROM footprint_bounds').all();
let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const { lng, lat } of rows) {
  minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
  minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
}
const pad = CLOSE_CELLS + 2;
const originLng = minLng - pad * CELL_LNG;
const originLat = minLat - pad * CELL_LAT;
const width = Math.ceil((maxLng - originLng) / CELL_LNG) + pad;
const height = Math.ceil((maxLat - originLat) / CELL_LAT) + pad;
let grid = new Uint8Array(width * height);
for (const { lng, lat } of rows) {
  grid[Math.floor((lat - originLat) / CELL_LAT) * width + Math.floor((lng - originLng) / CELL_LNG)] = 1;
}

// Square-window dilation / erosion.
function morph(source, radius, dilate) {
  const result = new Uint8Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = dilate ? 0 : 1;
      for (let dy = -radius; dy <= radius && value === (dilate ? 0 : 1); dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx, ny = y + dy;
          const cell = nx < 0 || ny < 0 || nx >= width || ny >= height ? 0 : source[ny * width + nx];
          if (dilate && cell) { value = 1; break; }
          if (!dilate && !cell) { value = 0; break; }
        }
      }
      result[y * width + x] = value;
    }
  }
  return result;
}
grid = morph(morph(grid, CLOSE_CELLS, true), CLOSE_CELLS, false);

// Keep connected regions that are large enough.
const label = new Int32Array(grid.length).fill(-1);
for (let start = 0; start < grid.length; start += 1) {
  if (!grid[start] || label[start] >= 0) continue;
  const stack = [start];
  const members = [];
  label[start] = start;
  while (stack.length) {
    const cell = stack.pop();
    members.push(cell);
    const x = cell % width, y = (cell - x) / width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (grid[next] && label[next] < 0) { label[next] = start; stack.push(next); }
    }
  }
  if (members.length < MIN_REGION_CELLS) for (const cell of members) grid[cell] = 0;
}

// Trace boundaries: each filled cell contributes four counter-clockwise edges;
// edges shared with a filled neighbor cancel, the rest chain into rings.
const key = (x, y) => `${x},${y}`;
const edges = new Map();
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    if (!grid[y * width + x]) continue;
    const filled = (nx, ny) => nx >= 0 && ny >= 0 && nx < width && ny < height && grid[ny * width + nx];
    if (!filled(x, y - 1)) edges.set(key(x, y), [...(edges.get(key(x, y)) ?? []), [x + 1, y]]);
    if (!filled(x + 1, y)) edges.set(key(x + 1, y), [...(edges.get(key(x + 1, y)) ?? []), [x + 1, y + 1]]);
    if (!filled(x, y + 1)) edges.set(key(x + 1, y + 1), [...(edges.get(key(x + 1, y + 1)) ?? []), [x, y + 1]]);
    if (!filled(x - 1, y)) edges.set(key(x, y + 1), [...(edges.get(key(x, y + 1)) ?? []), [x, y]]);
  }
}
const rings = [];
for (const [startKey] of edges) {
  while (edges.get(startKey)?.length) {
    const [sx, sy] = startKey.split(',').map(Number);
    const ring = [[sx, sy]];
    let current = startKey;
    for (;;) {
      const outgoing = edges.get(current);
      const [nx, ny] = outgoing.pop();
      if (!outgoing.length) edges.delete(current);
      current = key(nx, ny);
      if (current === startKey) break;
      ring.push([nx, ny]);
    }
    rings.push(ring);
  }
}

const signedArea = (ring) => ring.reduce((sum, [x, y], index) => {
  const [nx, ny] = ring[(index + 1) % ring.length];
  return sum + x * ny - nx * y;
}, 0) / 2;
// Outer boundaries run counter-clockwise; holes (parks inside a borough) are dropped.
const outers = rings.filter((ring) => signedArea(ring) > 0);

function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first], [bx, by] = points[last];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let farthest = -1, distance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const [px, py] = points[index];
      const offset = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (offset > distance) { distance = offset; farthest = index; }
    }
    if (farthest >= 0) { keep[farthest] = 1; stack.push([first, farthest], [farthest, last]); }
  }
  return points.filter((_, index) => keep[index]);
}

// Chaikin corner cutting softens the staircase of grid edges.
function smooth(ring, iterations) {
  let points = ring;
  for (let step = 0; step < iterations; step += 1) {
    const next = [];
    points.forEach(([x, y], index) => {
      const [nx, ny] = points[(index + 1) % points.length];
      next.push([0.75 * x + 0.25 * nx, 0.75 * y + 0.25 * ny], [0.25 * x + 0.75 * nx, 0.25 * y + 0.75 * ny]);
    });
    points = next;
  }
  return points;
}

// A closed ring's ends coincide, so split it at the point farthest from the
// start and simplify each half on its own.
function simplifyClosed(ring, tolerance) {
  const [sx, sy] = ring[0];
  let split = 1;
  ring.forEach(([x, y], index) => {
    if (Math.hypot(x - sx, y - sy) > Math.hypot(ring[split][0] - sx, ring[split][1] - sy)) split = index;
  });
  const first = simplify(ring.slice(0, split + 1), tolerance);
  const second = simplify([...ring.slice(split), ring[0]], tolerance);
  return [...first, ...second.slice(1, -1)];
}

const outlines = outers
  .map((ring) => smooth(simplifyClosed(ring, 0.7), 1))
  .map((ring) => ring.map(([x, y]) => [
    Number((originLng + x * CELL_LNG).toFixed(4)),
    Number((originLat + y * CELL_LAT).toFixed(4)),
  ]));

const file = `// Generated by scripts/build-coverage.mjs from the footprint index; do not edit by hand.
// Outer boundaries of the area with NYC / TUM 3D building models, as [lng, lat] rings.
export const COVERAGE = {
  buildingCount: ${rows.length},
  rings: ${JSON.stringify(outlines)},
} as const;
`;
await writeFile(OUTPUT, file);
console.log(`Wrote ${outlines.length} rings, ${outlines.reduce((sum, ring) => sum + ring.length, 0)} points, ${(file.length / 1024).toFixed(1)} KB from ${rows.length.toLocaleString()} buildings`);
