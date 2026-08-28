import 'server-only';

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LatLng } from '@/lib/solar/types';
import type { GbaBuildingMatch } from './demo-buildings';
import { findGbaDemoBuilding } from './demo-buildings';

type Coordinate = [number, number];
type PolygonCoordinates = Coordinate[][];
type Geometry =
  | { type: 'Polygon'; coordinates: PolygonCoordinates }
  | { type: 'MultiPolygon'; coordinates: PolygonCoordinates[] };

type BuildingRow = {
  gba_key: string;
  geometry_json: string;
  height: number | null;
  height_variance: number | null;
};

let database: DatabaseSync | null | undefined;

function getDatabase() {
  if (database !== undefined) return database;
  const configuredPath = process.env.GBA_NYC_DB_PATH;
  const databasePath = configuredPath
    ? resolve(configuredPath)
    : join(process.cwd(), 'data', 'processed', 'gba-nyc.sqlite');
  database = existsSync(databasePath) ? new DatabaseSync(databasePath, { readOnly: true }) : null;
  return database;
}

function longitudeToX(longitude: number) {
  return longitude * 20037508.34 / 180;
}

function latitudeToY(latitude: number) {
  const radians = latitude * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2)) * 6378137;
}

function xToLongitude(x: number) {
  return x * 180 / 20037508.34;
}

function yToLatitude(y: number) {
  return (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI;
}

function pointInRing(x: number, y: number, ring: Coordinate[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentX, currentY] = ring[index];
    const [priorX, priorY] = ring[previous];
    if ((currentY > y) !== (priorY > y) && x < (priorX - currentX) * (y - currentY) / (priorY - currentY) + currentX) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(x: number, y: number, polygon: PolygonCoordinates) {
  if (!polygon[0] || !pointInRing(x, y, polygon[0])) return false;
  return polygon.slice(1).every((hole) => !pointInRing(x, y, hole));
}

function polygonArea(ring: Coordinate[]) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function selectPolygon(geometry: Geometry, x: number, y: number) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.find((polygon) => pointInPolygon(x, y, polygon))
    ?? [...polygons].sort((a, b) => polygonArea(b[0] || []) - polygonArea(a[0] || []))[0];
}

function rowToMatch(row: BuildingRow, x: number, y: number): GbaBuildingMatch | null {
  const height = Number(row.height);
  if (!Number.isFinite(height) || height <= 0) return null;
  const geometry = JSON.parse(row.geometry_json) as Geometry;
  const polygon = selectPolygon(geometry, x, y);
  const outerRing = polygon?.[0];
  if (!outerRing || outerRing.length < 4) return null;
  return {
    id: row.gba_key,
    address: '',
    heightMeters: height,
    heightVariance: Number.isFinite(Number(row.height_variance)) ? Number(row.height_variance) : 0,
    footprint: outerRing.slice(0, -1).map(([pointX, pointY]) => ({
      latitude: yToLatitude(pointY),
      longitude: xToLongitude(pointX),
    })),
  };
}

export function findGbaBuilding(location: LatLng): GbaBuildingMatch | null {
  const db = getDatabase();
  if (!db) return findGbaDemoBuilding(location);
  const x = longitudeToX(location.longitude);
  const y = latitudeToY(location.latitude);
  const radius = 25;
  const rows = db.prepare(`
    SELECT b.gba_key, b.geometry_json, b.height, b.height_variance,
      CASE WHEN ? BETWEEN r.min_x AND r.max_x AND ? BETWEEN r.min_y AND r.max_y THEN 0
           ELSE (b.centroid_x - ?) * (b.centroid_x - ?) + (b.centroid_y - ?) * (b.centroid_y - ?) END AS distance_score
    FROM building_rtree r
    JOIN buildings b ON b.id = r.id
    WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ?
    ORDER BY distance_score ASC
    LIMIT 24
  `).all(x, y, x, x, y, y, x - radius, x + radius, y - radius, y + radius) as BuildingRow[];
  for (const row of rows) {
    const geometry = JSON.parse(row.geometry_json) as Geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (polygons.some((polygon) => pointInPolygon(x, y, polygon))) return rowToMatch(row, x, y);
  }
  return rows[0] ? rowToMatch(rows[0], x, y) : findGbaDemoBuilding(location);
}
