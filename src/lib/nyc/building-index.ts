import 'server-only';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inflateSync } from 'node:zlib';
import type { LatLng } from '@/lib/solar/types';
import { containsLocation, projectLocation, type CityBuilding } from './geometry';
import { parseCityBuilding } from './citygml';

let database: DatabaseSync | undefined;

function openDatabase(): DatabaseSync {
  if (!database) {
    const path = process.env.NYC_TUM_DB_PATH || join(process.cwd(), 'data/processed/nyc-citygml.sqlite');
    database = new DatabaseSync(path, { readOnly: true });
    const metadata = database.prepare("SELECT value FROM metadata WHERE key='complete'").get();
    if (metadata?.value !== 'true') {
      database.close(); database = undefined;
      throw new Error('NYC_MODEL_DATABASE_INCOMPLETE');
    }
  }
  return database;
}

const decode = (row: { xml: Uint8Array }) => parseCityBuilding(inflateSync(row.xml).toString('utf8'));

export function findNycBuilding(location: LatLng): CityBuilding | null {
  const [x, y] = projectLocation(location);
  const rows = openDatabase().prepare(`
    SELECT b.xml FROM bounds r JOIN buildings b ON b.id=r.id
    WHERE r.min_x <= ? AND r.max_x >= ? AND r.min_y <= ? AND r.max_y >= ?
    ORDER BY (r.max_x-r.min_x)*(r.max_y-r.min_y)
  `).all(x, x, y, y) as { xml: Uint8Array }[];
  for (const row of rows) {
    const building = decode(row);
    if (containsLocation(building, x, y)) return building;
  }
  return null;
}

export function findNycBuildingById(gmlId: string): CityBuilding | null {
  const row = openDatabase().prepare('SELECT xml FROM buildings WHERE gml_id = ?').get(gmlId) as { xml: Uint8Array } | undefined;
  return row ? decode(row) : null;
}

// Buildings whose footprint bounds come within `radiusMeters` of the target's.
export function findNeighborBuildings(target: CityBuilding, radiusMeters: number): CityBuilding[] {
  const rows = openDatabase().prepare(`
    SELECT b.gml_id, b.xml FROM bounds r JOIN buildings b ON b.id=r.id
    WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ?
  `).all(
    target.lower[0] - radiusMeters, target.upper[0] + radiusMeters,
    target.lower[1] - radiusMeters, target.upper[1] + radiusMeters,
  ) as { gml_id: string; xml: Uint8Array }[];
  return rows.filter((row) => row.gml_id !== target.id).map(decode);
}
