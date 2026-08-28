import { createReadStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');
const { streamObject } = require('stream-json/streamers/StreamObject');

const root = process.cwd();
const rawDirectory = resolve(process.env.GBA_RAW_DIR || join(root, 'data', 'raw', 'gba'));
const outputPath = resolve(process.env.GBA_NYC_DB_PATH || join(root, 'data', 'processed', 'gba-nyc.sqlite'));
const polygonFiles = [
  join(rawDirectory, 'w075_n45_w070_n40.odbl.geojson'),
  join(rawDirectory, 'w075_n45_w070_n40.part2.geojson'),
];
const heightFile = join(rawDirectory, 'w075_n45_w070_n40.lod1.json');

// A small margin around New York City keeps waterfront and boundary buildings available.
const nycBounds = { west: -74.30, south: 40.45, east: -73.65, north: 40.95 };

function longitudeToX(longitude) {
  return longitude * 20037508.34 / 180;
}

function latitudeToY(latitude) {
  const radians = latitude * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2)) * 6378137;
}

const clip = {
  minX: longitudeToX(nycBounds.west),
  maxX: longitudeToX(nycBounds.east),
  minY: latitudeToY(nycBounds.south),
  maxY: latitudeToY(nycBounds.north),
};

function geometryBounds(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      minX = Math.min(minX, value[0]);
      maxX = Math.max(maxX, value[0]);
      minY = Math.min(minY, value[1]);
      maxY = Math.max(maxY, value[1]);
      return;
    }
    for (const child of value) visit(child);
  };
  visit(geometry?.coordinates);
  return { minX, minY, maxX, maxY };
}

function intersectsNyc(bounds) {
  return bounds.maxX >= clip.minX && bounds.minX <= clip.maxX
    && bounds.maxY >= clip.minY && bounds.minY <= clip.maxY;
}

function ensureInputs() {
  for (const path of [...polygonFiles, heightFile]) {
    if (!existsSync(path)) throw new Error(`Missing GlobalBuildingAtlas input: ${path}`);
  }
}

async function importPolygons(db, filePath, statements) {
  const input = chain([
    createReadStream(filePath),
    parser(),
    pick({ filter: 'features' }),
    streamArray(),
  ]);
  let scanned = 0;
  let selected = 0;
  db.exec('BEGIN');
  try {
    for await (const item of input) {
      scanned += 1;
      const feature = item.value;
      const geometry = feature?.geometry;
      if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) continue;
      const bounds = geometryBounds(geometry);
      if (!Number.isFinite(bounds.minX) || !intersectsNyc(bounds)) continue;
      const source = String(feature.properties?.source || 'unknown');
      const sourceId = String(feature.properties?.id || '');
      const region = String(feature.properties?.region || '');
      if (!sourceId) continue;
      const gbaKey = `${source}${sourceId}${region}`;
      const result = statements.insert.run(
        gbaKey,
        source,
        sourceId,
        region,
        JSON.stringify(geometry),
        bounds.minX,
        bounds.maxX,
        bounds.minY,
        bounds.maxY,
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minY + bounds.maxY) / 2,
      );
      if (result.changes > 0) {
        statements.insertRtree.run(result.lastInsertRowid, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY);
        selected += 1;
      }
      if (selected > 0 && selected % 25_000 === 0) {
        db.exec('COMMIT; BEGIN');
        console.log(`  retained ${selected.toLocaleString()} NYC-area footprints (${scanned.toLocaleString()} scanned)`);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { scanned, selected };
}

async function importHeights(db, filePath) {
  const keys = new Set(db.prepare('SELECT gba_key FROM buildings').all().map((row) => row.gba_key));
  const update = db.prepare('UPDATE buildings SET height = ?, height_variance = ? WHERE gba_key = ?');
  const input = chain([createReadStream(filePath), parser(), streamObject()]);
  let scanned = 0;
  let matched = 0;
  db.exec('BEGIN');
  try {
    for await (const item of input) {
      scanned += 1;
      if (!keys.has(item.key)) continue;
      const height = Number(item.value?.height);
      const variance = Number(item.value?.var);
      if (Number.isFinite(height)) {
        update.run(height, Number.isFinite(variance) ? variance : null, item.key);
        matched += 1;
      }
      if (matched > 0 && matched % 25_000 === 0) {
        db.exec('COMMIT; BEGIN');
        console.log(`  joined ${matched.toLocaleString()} heights (${scanned.toLocaleString()} records scanned)`);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { scanned, matched };
}

ensureInputs();
mkdirSync(dirname(outputPath), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  const path = `${outputPath}${suffix}`;
  if (existsSync(path)) rmSync(path);
}

const db = new DatabaseSync(outputPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  CREATE TABLE buildings (
    id INTEGER PRIMARY KEY,
    gba_key TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    region TEXT NOT NULL,
    geometry_json TEXT NOT NULL,
    min_x REAL NOT NULL,
    max_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_y REAL NOT NULL,
    centroid_x REAL NOT NULL,
    centroid_y REAL NOT NULL,
    height REAL,
    height_variance REAL
  );
  CREATE VIRTUAL TABLE building_rtree USING rtree(id, min_x, max_x, min_y, max_y);
`);
const statements = {
  insert: db.prepare(`
    INSERT OR IGNORE INTO buildings (
      gba_key, source, source_id, region, geometry_json,
      min_x, max_x, min_y, max_y, centroid_x, centroid_y
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertRtree: db.prepare('INSERT INTO building_rtree (id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)'),
};

console.log(`Building NYC index at ${outputPath}`);
let totalScanned = 0;
let totalSelected = 0;
for (const filePath of polygonFiles) {
  console.log(`Reading footprints from ${filePath}`);
  const result = await importPolygons(db, filePath, statements);
  totalScanned += result.scanned;
  totalSelected += result.selected;
}
console.log(`Reading heights from ${heightFile}`);
const heights = await importHeights(db, heightFile);
db.exec(`
  CREATE INDEX buildings_gba_key ON buildings(gba_key);
  CREATE INDEX buildings_source_id ON buildings(source, source_id);
  PRAGMA optimize;
  PRAGMA wal_checkpoint(TRUNCATE);
`);
db.close();
console.log(JSON.stringify({
  outputPath,
  bounds: nycBounds,
  footprintsScanned: totalScanned,
  footprintsSelected: totalSelected,
  heightRecordsScanned: heights.scanned,
  heightsMatched: heights.matched,
}, null, 2));
