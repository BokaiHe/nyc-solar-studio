import proj4 from 'proj4';
import type { LatLng, NeighborMesh, RoofModelData } from '@/lib/solar/types';
import { buildNeighborMesh, buildNycModel, containsLocation, NYC_CRS, projectLocation, type CityBuilding } from './geometry';
import { decodeModelTile, decodeOutlineTile, tileIndex, tileKey, type Outline } from './tile-format';

// Building lookups in the browser from the static tiles in public/data/nyc
// (see tile-format.ts): what the model, neighbor and footprint API routes
// used to answer from SQLite on a server.

const DATA_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/data/nyc`;
// Surrounding buildings counted as shade, as before on the server.
export const NEIGHBOR_RADIUS_METERS = 200;
// A click on a street or yard selects the closest building this near.
const SNAP_METERS = 25;

type TileIndex = { models: Set<string>; outlines: Set<string> };
let indexRequest: Promise<TileIndex> | null = null;

function loadIndex(): Promise<TileIndex> {
  indexRequest ??= fetch(`${DATA_URL}/index.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`Tile index unavailable (${response.status})`);
      return response.json() as Promise<{ models: string[]; outlines: string[] }>;
    })
    .then((index) => ({ models: new Set(index.models), outlines: new Set(index.outlines) }))
    .catch((error: unknown) => {
      indexRequest = null;
      throw error;
    });
  return indexRequest;
}

async function gunzip(response: Response): Promise<Uint8Array> {
  const stream = response.body!.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Decoded tiles stay cached for the session; a few hundred cover a long visit.
const modelTiles = new Map<string, Promise<CityBuilding[]>>();
const outlineTiles = new Map<string, Promise<Outline[]>>();
const MAX_CACHED_TILES = 400;

function cached<T>(cache: Map<string, Promise<T[]>>, key: string, load: () => Promise<T[]>): Promise<T[]> {
  let tile = cache.get(key);
  if (!tile) {
    tile = load().catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, tile);
    if (cache.size > MAX_CACHED_TILES) cache.delete(cache.keys().next().value!);
  }
  return tile;
}

async function fetchTile<T>(kind: 'm' | 'f', key: string, decode: (bytes: Uint8Array) => T[]): Promise<T[]> {
  const response = await fetch(`${DATA_URL}/${kind}/${key}.bin.gz`);
  if (!response.ok) throw new Error(`Tile ${kind}/${key} unavailable (${response.status})`);
  return decode(await gunzip(response));
}

// Grid cells within `reach` cells of a location.
function cellsAround(location: LatLng, reach: number): string[] {
  const [column, row] = tileIndex(location.longitude, location.latitude);
  const keys: string[] = [];
  for (let dc = -reach; dc <= reach; dc += 1) for (let dr = -reach; dr <= reach; dr += 1) keys.push(tileKey(column + dc, row + dr));
  return keys;
}

async function buildingsAround(location: LatLng, reach: number): Promise<CityBuilding[]> {
  const { models } = await loadIndex();
  const tiles = await Promise.all(cellsAround(location, reach)
    .filter((key) => models.has(key))
    .map((key) => cached(modelTiles, key, () => fetchTile('m', key, decodeModelTile))));
  return tiles.flat();
}

const toWgs84 = proj4(NYC_CRS, 'WGS84');
function buildingCenter(building: CityBuilding): LatLng {
  const [longitude, latitude] = toWgs84.forward([(building.lower[0] + building.upper[0]) / 2, (building.lower[1] + building.upper[1]) / 2]);
  return { latitude, longitude };
}

const footprintArea = (building: CityBuilding) => (building.upper[0] - building.lower[0]) * (building.upper[1] - building.lower[1]);
// Horizontal distance from a projected point to a building's bounds.
const boundsDistance = (building: CityBuilding, x: number, y: number) =>
  Math.hypot(Math.max(0, building.lower[0] - x, x - building.upper[0]), Math.max(0, building.lower[1] - y, y - building.upper[1]));

// The building under a point (the smallest when footprints nest), or failing
// that the nearest one within SNAP_METERS.
export async function findBuildingAt(location: LatLng): Promise<CityBuilding | null> {
  const [x, y] = projectLocation(location);
  const candidates = await buildingsAround(location, 1);
  const containing = candidates.filter((building) => containsLocation(building, x, y)).sort((a, b) => footprintArea(a) - footprintArea(b));
  if (containing.length) return containing[0];
  let nearest: CityBuilding | null = null;
  let best = SNAP_METERS;
  for (const building of candidates) {
    const distance = boundsDistance(building, x, y);
    if (distance < best) {
      best = distance;
      nearest = building;
    }
  }
  return nearest;
}

// A building by id near a known location (a clicked outline, a link or a draft).
export async function findBuildingById(id: string, location: LatLng): Promise<CityBuilding | null> {
  for (const reach of [1, 2]) {
    const match = (await buildingsAround(location, reach)).find((building) => building.id === id);
    if (match) return match;
  }
  return null;
}

export function roofModel(building: CityBuilding): RoofModelData {
  return buildNycModel(building);
}

// Buildings within NEIGHBOR_RADIUS_METERS of the target's bounds that can
// shade its roof, in the target's scene frame.
export async function neighborMesh(target: CityBuilding): Promise<NeighborMesh> {
  // Two cells (about 500 m) each way covers the radius plus large neighbors.
  const candidates = await buildingsAround(buildingCenter(target), 2);
  const near = candidates.filter((building) => building.id !== target.id
    && building.upper[0] >= target.lower[0] - NEIGHBOR_RADIUS_METERS && building.lower[0] <= target.upper[0] + NEIGHBOR_RADIUS_METERS
    && building.upper[1] >= target.lower[1] - NEIGHBOR_RADIUS_METERS && building.lower[1] <= target.upper[1] + NEIGHBOR_RADIUS_METERS);
  return buildNeighborMesh(target, near, NEIGHBOR_RADIUS_METERS);
}

export type Bounds = { south: number; west: number; north: number; east: number };

// Map outlines for a view, from every cell it touches plus one around (a
// building is filed under the cell of its center).
export async function outlinesInBounds(bounds: Bounds): Promise<Outline[]> {
  const { outlines } = await loadIndex();
  const [west, south] = tileIndex(bounds.west, bounds.south);
  const [east, north] = tileIndex(bounds.east, bounds.north);
  const keys: string[] = [];
  for (let column = west - 1; column <= east + 1; column += 1) {
    for (let row = south - 1; row <= north + 1; row += 1) {
      const key = tileKey(column, row);
      if (outlines.has(key)) keys.push(key);
    }
  }
  const tiles = await Promise.all(keys.map((key) => cached(outlineTiles, key, () => fetchTile('f', key, decodeOutlineTile))));
  return tiles.flat();
}
