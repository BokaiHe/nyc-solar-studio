import 'server-only';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inflateSync } from 'node:zlib';
import type { LatLng } from '@/lib/solar/types';
import { containsLocation, projectLocation, type CityBuilding } from './geometry';
import { parseCityBuilding } from './citygml';

let database: DatabaseSync | undefined;
export function findNycBuilding(location: LatLng): CityBuilding | null {
  if (!database) {
    const path = process.env.NYC_TUM_DB_PATH || join(process.cwd(), 'data/processed/nyc-citygml.sqlite');
    database = new DatabaseSync(path, { readOnly: true });
    const metadata = database.prepare("SELECT value FROM metadata WHERE key='complete'").get();
    if (metadata?.value !== 'true') {
      database.close(); database = undefined;
      throw new Error('NYC_MODEL_DATABASE_INCOMPLETE');
    }
  }
  const [x, y] = projectLocation(location);
  const rows = database.prepare(`
    SELECT b.xml FROM bounds r JOIN buildings b ON b.id=r.id
    WHERE r.min_x <= ? AND r.max_x >= ? AND r.min_y <= ? AND r.max_y >= ?
    ORDER BY (r.max_x-r.min_x)*(r.max_y-r.min_y)
  `).all(x, x, y, y) as { xml: Uint8Array }[];
  for (const row of rows) {
    const building = parseCityBuilding(inflateSync(row.xml).toString('utf8'));
    if (containsLocation(building, x, y)) return building;
  }
  return null;
}
