// Builds data/processed/nyc-footprints.sqlite: one simplified footprint per
// NYC / TUM building (WGS84), with height and address and an R-tree on bounds,
// so the map can outline every building that has a 3D model.
// Usage: node scripts/index-nyc-footprints.mjs [source.sqlite] [output.sqlite]
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const proj4 = require('proj4');

const SOURCE = process.argv[2] ?? 'data/processed/nyc-citygml.sqlite';
const OUTPUT = process.argv[3] ?? 'data/processed/nyc-footprints.sqlite';
const NYC_CRS = '+proj=lcc +lat_0=40.1666666666667 +lon_0=-74 +lat_1=41.0333333333333 +lat_2=40.6666666666667 +x_0=300000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
// Outline points closer than this to the simplified line are dropped.
const SIMPLIFY_METERS = 0.2;
const BATCH = 5000;

if (existsSync(OUTPUT)) throw new Error(`${OUTPUT} exists; remove it to rebuild.`);
const toWgs84 = proj4(NYC_CRS, 'WGS84');
const source = new DatabaseSync(SOURCE, { readOnly: true });
const output = new DatabaseSync(OUTPUT);
output.exec(`
  PRAGMA journal_mode=OFF;
  PRAGMA synchronous=OFF;
  CREATE TABLE footprints(id INTEGER PRIMARY KEY, gml_id TEXT NOT NULL, height REAL, address TEXT, rings BLOB NOT NULL);
  CREATE VIRTUAL TABLE footprint_bounds USING rtree(id, min_lng, max_lng, min_lat, max_lat);
  CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
`);
const insertFootprint = output.prepare('INSERT INTO footprints(id, gml_id, height, address, rings) VALUES (?, ?, ?, ?, ?)');
const insertBounds = output.prepare('INSERT INTO footprint_bounds(id, min_lng, max_lng, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)');

const GROUND = /<bldg:GroundSurface[\s\S]*?<\/bldg:GroundSurface>/g;
const EXTERIOR = /<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]+)<\/gml:posList>/g;
const ROOF = /<bldg:RoofSurface[\s\S]*?<\/bldg:RoofSurface>/g;
const ENVELOPE_LOW = /<gml:lowerCorner>([^<]+)<\/gml:lowerCorner>/;
const ENVELOPE_HIGH = /<gml:upperCorner>([^<]+)<\/gml:upperCorner>/;
const ADDRESS = /name="PLUTO_lot_address">\s*<gen:value>([^<]*)<\/gen:value>/;

function ringsIn(blocks) {
  const rings = [];
  for (const block of blocks) {
    for (const match of block.matchAll(EXTERIOR)) {
      const values = match[1].trim().split(/\s+/).map(Number);
      const ring = [];
      for (let index = 0; index + 2 < values.length; index += 3) ring.push([values[index], values[index + 1]]);
      if (ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}

// Douglas–Peucker on a closed ring in projected meters.
function simplify(points) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let farthest = -1;
    let distance = SIMPLIFY_METERS;
    for (let index = first + 1; index < last; index += 1) {
      const [px, py] = points[index];
      const offset = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (offset > distance) {
        distance = offset;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  const result = points.filter((_, index) => keep[index]);
  return result.length >= 4 ? result : points;
}

// Rings as Int32: [ringCount, n, lng×1e7, lat×1e7, …, n, …] (≈1 cm precision).
function encode(rings) {
  const values = [rings.length];
  for (const ring of rings) {
    values.push(ring.length);
    for (const [lng, lat] of ring) values.push(Math.round(lng * 1e7), Math.round(lat * 1e7));
  }
  return new Uint8Array(Int32Array.from(values).buffer);
}

const started = Date.now();
let done = 0;
let skipped = 0;
output.exec('BEGIN');
for (const row of source.prepare('SELECT id, gml_id, xml FROM buildings').iterate()) {
  const xml = inflateSync(row.xml).toString('utf8');
  // Ground outlines are the footprint; fall back to roof outlines when missing.
  let projected = ringsIn(xml.match(GROUND) ?? []);
  if (!projected.length) projected = ringsIn(xml.match(ROOF) ?? []);
  if (!projected.length) {
    skipped += 1;
    continue;
  }
  const rings = projected.map((ring) => simplify(ring).map((point) => toWgs84.forward(point)));
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  const low = xml.match(ENVELOPE_LOW)?.[1].trim().split(/\s+/).map(Number);
  const high = xml.match(ENVELOPE_HIGH)?.[1].trim().split(/\s+/).map(Number);
  const height = low && high ? Math.round((high[2] - low[2]) * 10) / 10 : null;
  insertFootprint.run(row.id, row.gml_id, height, xml.match(ADDRESS)?.[1].trim() || null, encode(rings));
  insertBounds.run(row.id, minLng, maxLng, minLat, maxLat);
  done += 1;
  if (done % BATCH === 0) {
    output.exec('COMMIT; BEGIN');
    const rate = done / ((Date.now() - started) / 1000);
    console.log(`${done.toLocaleString()} footprints · ${rate.toFixed(0)}/s · skipped ${skipped}`);
  }
}
output.exec('COMMIT');
output.prepare("INSERT INTO metadata(key, value) VALUES ('complete', 'true'), ('count', ?)").run(String(done));
console.log(`Done: ${done.toLocaleString()} footprints, skipped ${skipped}, ${((Date.now() - started) / 60000).toFixed(1)} min`);
