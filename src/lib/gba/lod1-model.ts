import { ShapeUtils, Vector2 } from 'three';
import type { LatLng, RoofModelData } from '@/lib/solar/types';
import type { GbaBuildingMatch } from './demo-buildings';

const METERS_PER_DEGREE_LATITUDE = 111_320;

function footprintCenter(footprint: LatLng[]) {
  const total = footprint.reduce((sum, point) => ({
    latitude: sum.latitude + point.latitude,
    longitude: sum.longitude + point.longitude,
  }), { latitude: 0, longitude: 0 });
  return {
    latitude: total.latitude / footprint.length,
    longitude: total.longitude / footprint.length,
  };
}

export function buildGbaLod1Model(building: GbaBuildingMatch): RoofModelData {
  if (building.footprint.length < 3) throw new Error('GBA footprint contains too few points');
  const center = footprintCenter(building.footprint);
  const metersPerDegreeLongitude = METERS_PER_DEGREE_LATITUDE * Math.cos(center.latitude * Math.PI / 180);
  const outline = building.footprint.map((point) => ({
    x: (point.longitude - center.longitude) * metersPerDegreeLongitude,
    z: -(point.latitude - center.latitude) * METERS_PER_DEGREE_LATITUDE,
  }));
  const minX = Math.min(...outline.map((point) => point.x));
  const maxX = Math.max(...outline.map((point) => point.x));
  const minZ = Math.min(...outline.map((point) => point.z));
  const maxZ = Math.max(...outline.map((point) => point.z));
  const offsetX = (minX + maxX) / 2;
  const offsetZ = (minZ + maxZ) / 2;
  const centered = outline.map((point) => ({ x: point.x - offsetX, z: point.z - offsetZ }));
  const height = Math.max(2.5, building.heightMeters);
  const positions = centered.flatMap((point) => [point.x, height, point.z]);
  const indices = ShapeUtils.triangulateShape(
    centered.map((point) => new Vector2(point.x, point.z)),
    [],
  ).flat();
  const wallPositions: number[] = [];
  const wallIndices: number[] = [];
  for (let index = 0; index < centered.length; index += 1) {
    const current = centered[index];
    const next = centered[(index + 1) % centered.length];
    const start = wallPositions.length / 3;
    wallPositions.push(
      current.x, 0, current.z,
      next.x, 0, next.z,
      current.x, height, current.z,
      next.x, height, next.z,
    );
    wallIndices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
  }
  return {
    positions,
    indices,
    wallPositions,
    wallIndices,
    deckPositions: [],
    deckIndices: [],
    widthMeters: maxX - minX,
    depthMeters: maxZ - minZ,
    baseElevationMeters: 0,
    center,
    imageryQuality: 'GBA_LOD1',
    buildingSource: 'GLOBAL_BUILDING_ATLAS_LOD1',
    gbaBuildingId: building.id,
    gbaHeightMeters: building.heightMeters,
    gbaHeightVariance: building.heightVariance,
  };
}
