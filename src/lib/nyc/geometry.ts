import proj4 from 'proj4';
import { ShapeUtils, Vector2 } from 'three';
import type { LatLng, NeighborMesh, RoofModelData } from '@/lib/solar/types';

export const NYC_CRS = '+proj=lcc +lat_0=40.1666666666667 +lon_0=-74 +lat_1=41.0333333333333 +lat_2=40.6666666666667 +x_0=300000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
export type Point3 = [number, number, number];
export type CitySurface = { type: string; rings: Point3[][] };
export type CityBuilding = {
  id: string; bin: string; address: string; geometrySource: string;
  lower: Point3; upper: Point3; surfaces: CitySurface[];
};

export function projectLocation(location: LatLng) {
  return proj4('WGS84', NYC_CRS, [location.longitude, location.latitude]);
}

function ringContains(x: number, y: number, ring: Point3[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function containsLocation(building: CityBuilding, x: number, y: number) {
  const grounds = building.surfaces.filter((surface) => surface.type === 'GroundSurface');
  const footprint = grounds.length ? grounds : building.surfaces.filter((surface) => surface.type === 'RoofSurface');
  return footprint.some(({ rings }) => ringContains(x, y, rings[0])
    && !rings.slice(1).some((hole) => ringContains(x, y, hole)));
}

// Dominant-plane triangulation preserves original heights and polygon holes.
export function triangulateSurface(rings: Point3[][]): number[] {
  const ring = rings[0], normal = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const drop = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const axes = [0, 1, 2].filter((axis) => axis !== drop);
  const flat = rings.map((r) => r.map((p) => new Vector2(p[axes[0]], p[axes[1]])));
  return ShapeUtils.triangulateShape(flat[0], flat.slice(1)).flat();
}

// The scene frame of a target building: meters east (x), up from its base (y)
// and south (z) of its bounds center. Neighbors use the same frame.
function localFrame(building: CityBuilding) {
  const [longitude, latitude] = proj4(NYC_CRS, 'WGS84', [
    (building.lower[0] + building.upper[0]) / 2,
    (building.lower[1] + building.upper[1]) / 2,
  ]);
  const xScale = 111320 * Math.cos(latitude * Math.PI / 180), base = building.lower[2];
  const toLocal = ([easting, northing, altitude]: Point3): Point3 => {
    const [lng, lat] = proj4(NYC_CRS, 'WGS84', [easting, northing]);
    return [(lng - longitude) * xScale, altitude - base, -(lat - latitude) * 111320];
  };
  return { latitude, longitude, base, toLocal };
}

export function buildNycModel(building: CityBuilding): RoofModelData {
  const { latitude, longitude, base, toLocal } = localFrame(building);
  const positions: number[] = [], indices: number[] = [], wallPositions: number[] = [], wallIndices: number[] = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const surface of building.surfaces) {
    const isRoof = surface.type === 'RoofSurface';
    const targetVertices = isRoof ? positions : wallPositions;
    const targetIndices = isRoof ? indices : wallIndices;
    const offset = targetVertices.length / 3;
    const localRings: Point3[][] = surface.rings.map((ring) => ring.map((point) => {
      const local = toLocal(point);
      minX = Math.min(minX, local[0]); maxX = Math.max(maxX, local[0]);
      minZ = Math.min(minZ, local[2]); maxZ = Math.max(maxZ, local[2]);
      return local;
    }));
    targetVertices.push(...localRings.flat(2));
    const triangles = triangulateSurface(localRings), vertices = localRings.flat();
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i];
      let b = triangles[i + 1], c = triangles[i + 2];
      if (isRoof) {
        const p = vertices[a], q = vertices[b], r = vertices[c];
        const normalY = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
        if (normalY < 0) [b, c] = [c, b];
      }
      targetIndices.push(a + offset, b + offset, c + offset);
    }
  }
  if (!indices.length) throw new Error('NYC building has no usable roof surfaces');
  return {
    positions, indices, wallPositions, wallIndices,
    widthMeters: maxX - minX, depthMeters: maxZ - minZ,
    baseElevationMeters: base, center: { latitude, longitude },
    buildingSource: 'NYC_TUM_LOD2', nycBuildingId: building.id, nycBin: building.bin,
    modelHeightMeters: building.upper[2] - base, modelAddress: building.address, modelRelease: '2017',
  };
}

// The sun samples used for shading start 3° above the horizon, so a neighbor
// can only shade the roof if it rises above it by more than tan(3°) per meter
// of horizontal distance.
const MIN_SHADING_SLOPE = Math.tan(3 * Math.PI / 180);
const SHADING_SURFACES = new Set(['RoofSurface', 'WallSurface', 'ClosureSurface', 'OuterCeilingSurface']);

// Surrounding buildings as one mesh in the target's scene frame, keeping only
// geometry that can cast a shadow on the target roof.
export function buildNeighborMesh(target: CityBuilding, neighbors: CityBuilding[], radiusMeters: number): NeighborMesh {
  const { toLocal } = localFrame(target);
  const roofLow = Math.min(...target.surfaces.filter((surface) => surface.type === 'RoofSurface').flatMap((surface) => surface.rings[0].map((point) => point[2])));
  const positions: number[] = [], indices: number[] = [], buildingStarts: number[] = [];
  for (const neighbor of neighbors) {
    const rise = neighbor.upper[2] - roofLow;
    const gapX = Math.max(0, neighbor.lower[0] - target.upper[0], target.lower[0] - neighbor.upper[0]);
    const gapY = Math.max(0, neighbor.lower[1] - target.upper[1], target.lower[1] - neighbor.upper[1]);
    if (rise <= 0 || rise < MIN_SHADING_SLOPE * Math.hypot(gapX, gapY)) continue;
    const start = indices.length;
    for (const surface of neighbor.surfaces) {
      if (!SHADING_SURFACES.has(surface.type)) continue;
      const rings = surface.rings.map((ring) => ring.map(toLocal));
      const vertices = rings.flat();
      const offset = positions.length / 3;
      const triangles = triangulateSurface(rings);
      let used = false;
      for (let i = 0; i < triangles.length; i += 3) {
        // Faces entirely below the roof cannot block rays leaving it upward.
        if (Math.max(vertices[triangles[i]][1], vertices[triangles[i + 1]][1], vertices[triangles[i + 2]][1]) < roofLow - target.lower[2] - 0.5) continue;
        indices.push(triangles[i] + offset, triangles[i + 1] + offset, triangles[i + 2] + offset);
        used = true;
      }
      if (used) for (const vertex of vertices) positions.push(Math.round(vertex[0] * 100) / 100, Math.round(vertex[1] * 100) / 100, Math.round(vertex[2] * 100) / 100);
    }
    if (indices.length > start) buildingStarts.push(start);
  }
  return { positions, indices, buildingStarts, buildingCount: buildingStarts.length, radiusMeters };
}
