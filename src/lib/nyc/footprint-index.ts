import 'server-only';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Footprints of every NYC / TUM building, built by scripts/index-nyc-footprints.mjs.
export type Footprint = {
  id: string;
  height: number | null;
  address: string | null;
  // Rings as flat [lng, lat, lng, lat, …] arrays.
  rings: number[][];
};

export type Bounds = { south: number; west: number; north: number; east: number };

let database: DatabaseSync | null | undefined;

function openDatabase(): DatabaseSync | null {
  if (database === undefined) {
    const path = process.env.NYC_FOOTPRINTS_DB_PATH || join(process.cwd(), 'data/processed/nyc-footprints.sqlite');
    database = existsSync(path) ? new DatabaseSync(path, { readOnly: true }) : null;
    if (database && database.prepare("SELECT value FROM metadata WHERE key='complete'").get()?.value !== 'true') {
      database.close();
      database = null;
    }
  }
  return database;
}

export function footprintsAvailable(): boolean {
  return openDatabase() !== null;
}

function decodeRings(blob: Uint8Array): number[][] {
  const values = new Int32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
  const rings: number[][] = [];
  let index = 1;
  for (let ring = 0; ring < values[0]; ring += 1) {
    const count = values[index++];
    const flat = new Array<number>(count * 2);
    for (let point = 0; point < count * 2; point += 1) flat[point] = values[index++] / 1e7;
    rings.push(flat);
  }
  return rings;
}

export function footprintsInBounds(bounds: Bounds, limit: number): { footprints: Footprint[]; truncated: boolean } {
  const db = openDatabase();
  if (!db) throw new Error('FOOTPRINTS_UNAVAILABLE');
  const rows = db.prepare(`
    SELECT f.gml_id, f.height, f.address, f.rings FROM footprint_bounds b JOIN footprints f ON f.id = b.id
    WHERE b.max_lng >= ? AND b.min_lng <= ? AND b.max_lat >= ? AND b.min_lat <= ?
    LIMIT ?
  `).all(bounds.west, bounds.east, bounds.south, bounds.north, limit + 1) as Array<{ gml_id: string; height: number | null; address: string | null; rings: Uint8Array }>;
  return {
    footprints: rows.slice(0, limit).map((row) => ({ id: row.gml_id, height: row.height, address: row.address, rings: decodeRings(row.rings) })),
    truncated: rows.length > limit,
  };
}
