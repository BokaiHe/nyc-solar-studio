import { getSunSnapshot } from '../solar/sun';
import type { LatLng } from '@/lib/solar/types';
import type { Vec3 } from './roof-faces';

export type SunSample = { direction: Vec3; weight: number };

const MIN_SUN_ALTITUDE_DEGREES = 3;
const RAY_START_OFFSET = 0.3;
const EPSILON = 1e-7;

// Hourly sun positions on the 21st of every month. Each sample is weighted by
// a clear-sky beam intensity so low winter sun counts for less.
export function annualSunSamples(location: LatLng, year = 2025): SunSample[] {
  const samples: SunSample[] = [];
  for (let month = 0; month < 12; month += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const sun = getSunSnapshot(new Date(Date.UTC(year, month, 21, hour, 30)), location.latitude, location.longitude);
      if (sun.altitudeDegrees < MIN_SUN_ALTITUDE_DEGREES) continue;
      const altitude = (sun.altitudeDegrees * Math.PI) / 180;
      const azimuth = (sun.azimuthDegrees * Math.PI) / 180;
      const airMass = 1 / Math.sin(altitude);
      samples.push({
        // Scene x is east and z is south.
        direction: [Math.sin(azimuth) * Math.cos(altitude), Math.sin(altitude), -Math.cos(azimuth) * Math.cos(altitude)],
        weight: 0.7 ** (airMass ** 0.678),
      });
    }
  }
  return samples;
}

export function panelNormal(azimuthDegrees: number, tiltDegrees: number): Vec3 {
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  const tilt = (tiltDegrees * Math.PI) / 180;
  return [Math.sin(azimuth) * Math.sin(tilt), Math.cos(tilt), -Math.cos(azimuth) * Math.sin(tilt)];
}

// Flat triangle soup with per-triangle bounds for fast "any hit" ray queries.
export class Occluders {
  private readonly data: Float32Array;
  private readonly count: number;

  constructor(positions: number[][], indices: number[][]) {
    const triangles: number[] = [];
    positions.forEach((list, mesh) => {
      const index = indices[mesh];
      for (let t = 0; t < index.length; t += 3) {
        for (let corner = 0; corner < 3; corner += 1) {
          const v = index[t + corner] * 3;
          triangles.push(list[v], list[v + 1], list[v + 2]);
        }
      }
    });
    this.data = Float32Array.from(triangles);
    this.count = triangles.length / 9;
  }

  // Möller–Trumbore, returning on the first hit beyond the start offset.
  blocked(origin: Vec3, direction: Vec3): boolean {
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = direction;
    const d = this.data;
    for (let t = 0; t < this.count; t += 1) {
      const i = t * 9;
      // Skip triangles entirely below the ray start when the ray points up.
      if (dy > 0 && d[i + 1] < oy && d[i + 4] < oy && d[i + 7] < oy) continue;
      const e1x = d[i + 3] - d[i], e1y = d[i + 4] - d[i + 1], e1z = d[i + 5] - d[i + 2];
      const e2x = d[i + 6] - d[i], e2y = d[i + 7] - d[i + 1], e2z = d[i + 8] - d[i + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < EPSILON) continue;
      const inv = 1 / det;
      const tx = ox - d[i], ty = oy - d[i + 1], tz = oz - d[i + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      if ((e2x * qx + e2y * qy + e2z * qz) * inv > EPSILON) return true;
    }
    return false;
  }
}

// Annual beam exposure of a panel at `center`, relative units. `unshaded`
// ignores occluders, so score / unshaded is the fraction kept after shading.
export function exposure(center: Vec3, normal: Vec3, samples: SunSample[], occluders: Occluders) {
  const origin: Vec3 = [center[0] + normal[0] * RAY_START_OFFSET, center[1] + normal[1] * RAY_START_OFFSET, center[2] + normal[2] * RAY_START_OFFSET];
  let score = 0;
  let unshaded = 0;
  for (const { direction, weight } of samples) {
    const incidence = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
    if (incidence <= 0) continue;
    const gain = incidence * weight;
    unshaded += gain;
    if (!occluders.blocked(origin, direction)) score += gain;
  }
  return { score, unshaded };
}
