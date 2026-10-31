// Builds public/data/nyc: every NYC / TUM building as static, gzip-compressed
// grid tiles (3D models and map outlines) plus an index of non-empty tiles, so
// the app can be served as a static site without a database or server.
// Usage: node scripts/build-static-tiles.mts [citygml.sqlite] [footprints.sqlite] [output dir] [west,south,east,north]
// Tiles already written are kept, so an interrupted run can resume.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, inflateSync } from 'node:zlib';
import { parseCityBuilding } from '../src/lib/nyc/citygml.ts';
import type { CityBuilding } from '../src/lib/nyc/geometry.ts';
import {
  encodeModelTile, encodeOutlineTile, TILE_LAT_DEGREES, TILE_LNG_DEGREES, tileIndex, tileKey, type Outline,
} from '../src/lib/nyc/tile-format.ts';

const require = createRequire(import.meta.url);
const proj4 = require('proj4');

const CITYGML = process.argv[2] ?? 'data/processed/nyc-citygml.sqlite';
const FOOTPRINTS = process.argv[3] ?? 'data/processed/nyc-footprints.sqlite';
const OUTPUT = process.argv[4] ?? 'public/data/nyc';
// An optional bounding box limits the build to a test area.
const AREA = process.argv[5]?.split(',').map(Number);
const NYC_CRS = '+proj=lcc +lat_0=40.1666666666667 +lon_0=-74 +lat_1=41.0333333333333 +lat_2=40.6666666666667 +x_0=300000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const toWgs84 = proj4(NYC_CRS, 'WGS84');
const toPlane = proj4('WGS84', NYC_CRS);

for (const dir of ['m', 'f']) mkdirSync(join(OUTPUT, dir), { recursive: true });
const written = (dir: string) => new Set(readdirSync(join(OUTPUT, dir)).map((name) => name.replace('.bin.gz', '')));
const write = (dir: string, key: string, bytes: Uint8Array) =>
  writeFileSync(join(OUTPUT, dir, `${key}.bin.gz`), gzipSync(bytes, { level: 9 }));

const started = Date.now();
const minutes = () => ((Date.now() - started) / 60000).toFixed(1);

// Outlines: grouped by the cell of their bounds center.
const footprints = new DatabaseSync(FOOTPRINTS, { readOnly: true });
const extent = AREA
  ? { w: AREA[0], s: AREA[1], e: AREA[2], n: AREA[3] }
  : footprints.prepare('SELECT min(min_lng) w, max(max_lng) e, min(min_lat) s, max(max_lat) n FROM footprint_bounds').get() as { w: number; e: number; s: number; n: number };
const [firstColumn, firstRow] = tileIndex(extent.w, extent.s);
const [lastColumn, lastRow] = tileIndex(extent.e, extent.n);
console.log(`Grid ${lastColumn - firstColumn + 1} × ${lastRow - firstRow + 1} cells`);

function decodeRings(blob: Uint8Array): number[][] {
  const values = new Int32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
  const rings: number[][] = [];
  let index = 1;
  for (let ring = 0; ring < values[0]; ring += 1) {
    const count = values[index++];
    rings.push(Array.from(values.subarray(index, index + count * 2), (value) => value / 1e7));
    index += count * 2;
  }
  return rings;
}

const outlinesDone = written('f');
const outlineQuery = footprints.prepare(`
  SELECT f.gml_id, f.height, f.address, f.rings, b.min_lng, b.max_lng, b.min_lat, b.max_lat
  FROM footprint_bounds b JOIN footprints f ON f.id = b.id
  WHERE b.max_lng >= ? AND b.min_lng <= ? AND b.max_lat >= ? AND b.min_lat <= ?
`);
let outlineCount = 0;
for (let column = firstColumn; column <= lastColumn; column += 1) {
  for (let row = firstRow; row <= lastRow; row += 1) {
    const key = tileKey(column, row);
    if (outlinesDone.has(key)) continue;
    const west = column * TILE_LNG_DEGREES, south = row * TILE_LAT_DEGREES;
    const rows = outlineQuery.all(west, west + TILE_LNG_DEGREES, south, south + TILE_LAT_DEGREES) as Array<{
      gml_id: string; height: number | null; address: string | null; rings: Uint8Array;
      min_lng: number; max_lng: number; min_lat: number; max_lat: number;
    }>;
    const outlines: Outline[] = rows
      .filter((item) => {
        const [c, r] = tileIndex((item.min_lng + item.max_lng) / 2, (item.min_lat + item.max_lat) / 2);
        return c === column && r === row;
      })
      .map((item) => ({ id: item.gml_id, height: item.height, address: item.address, rings: decodeRings(item.rings) }));
    if (!outlines.length) continue;
    write('f', key, encodeOutlineTile(outlines));
    outlineCount += outlines.length;
  }
}
console.log(`Outlines: ${outlineCount.toLocaleString()} written · ${minutes()} min`);

// Models: candidates from the state-plane R-tree around each cell, kept when
// their bounds center falls in the cell.
const citygml = new DatabaseSync(CITYGML, { readOnly: true });
const modelQuery = citygml.prepare(`
  SELECT b.xml, r.min_x, r.max_x, r.min_y, r.max_y FROM bounds r JOIN buildings b ON b.id = r.id
  WHERE (r.min_x + r.max_x) / 2 BETWEEN ? AND ? AND (r.min_y + r.max_y) / 2 BETWEEN ? AND ?
`);
const modelsDone = written('m');
let modelCount = 0;
let failed = 0;
let cells = 0;
const totalCells = (lastColumn - firstColumn + 1) * (lastRow - firstRow + 1);
for (let column = firstColumn; column <= lastColumn; column += 1) {
  for (let row = firstRow; row <= lastRow; row += 1) {
    cells += 1;
    const key = tileKey(column, row);
    if (modelsDone.has(key)) continue;
    const west = column * TILE_LNG_DEGREES, south = row * TILE_LAT_DEGREES;
    const corners = [[west, south], [west + TILE_LNG_DEGREES, south], [west, south + TILE_LAT_DEGREES], [west + TILE_LNG_DEGREES, south + TILE_LAT_DEGREES]]
      .map((corner) => toPlane.forward(corner) as [number, number]);
    const xs = corners.map((corner) => corner[0]), ys = corners.map((corner) => corner[1]);
    const rows = modelQuery.all(Math.min(...xs) - 5, Math.max(...xs) + 5, Math.min(...ys) - 5, Math.max(...ys) + 5) as Array<{
      xml: Uint8Array; min_x: number; max_x: number; min_y: number; max_y: number;
    }>;
    const buildings: CityBuilding[] = [];
    for (const item of rows) {
      const [lng, lat] = toWgs84.forward([(item.min_x + item.max_x) / 2, (item.min_y + item.max_y) / 2]) as [number, number];
      const [c, r] = tileIndex(lng, lat);
      if (c !== column || r !== row) continue;
      try {
        buildings.push(parseCityBuilding(inflateSync(item.xml).toString('utf8')));
      } catch {
        failed += 1;
      }
    }
    if (buildings.length) {
      write('m', key, encodeModelTile(buildings));
      modelCount += buildings.length;
    }
    if (cells % 500 === 0) console.log(`Models: ${cells}/${totalCells} cells · ${modelCount.toLocaleString()} buildings · ${failed} failed · ${minutes()} min`);
  }
}

// The index lists non-empty tiles so the app never requests empty cells.
const index = {
  version: 1,
  tileLngDegrees: TILE_LNG_DEGREES,
  tileLatDegrees: TILE_LAT_DEGREES,
  models: [...written('m')].sort(),
  outlines: [...written('f')].sort(),
};
writeFileSync(join(OUTPUT, 'index.json'), JSON.stringify(index));
console.log(`Done: ${index.models.length} model tiles, ${index.outlines.length} outline tiles, ${failed} failed · ${minutes()} min`);
if (!existsSync(join(OUTPUT, 'index.json'))) process.exit(1);
