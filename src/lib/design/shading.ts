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

// Which sun samples reach a roof point, cached on a coarse grid. Visibility
// depends only on position, so every layout tried for a roof can share it.
export class VisibilityCache {
  private readonly cache = new Map<string, Uint8Array>();

  constructor(readonly samples: SunSample[], private readonly occluders: Occluders, private readonly cellMeters = 1.5) {}

  at(position: Vec3): Uint8Array {
    const key = `${Math.round(position[0] / this.cellMeters)}:${Math.round(position[1] / 0.5)}:${Math.round(position[2] / this.cellMeters)}`;
    let visible = this.cache.get(key);
    if (!visible) {
      const origin: Vec3 = [position[0], position[1] + RAY_START_OFFSET, position[2]];
      visible = Uint8Array.from(this.samples, ({ direction }) => (this.occluders.blocked(origin, direction) ? 0 : 1));
      this.cache.set(key, visible);
    }
    return visible;
  }
}

// Share of a rack panel's surface in the shadow of the row in front of it
// (toward the sun), for infinitely long rows. In a vertical section along the
// facing direction the front row's top edge, at height H = L·sin(tilt), casts
// its shadow back at the sun's profile angle onto the next panel.
export function rowShadeFraction(direction: Vec3, azimuthDegrees: number, tiltDegrees: number, lengthMeters: number, pitchMeters: number): number {
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  const along = direction[0] * Math.sin(azimuth) - direction[2] * Math.cos(azimuth);
  // The front row only shades this one while the sun is on the facing side.
  if (along <= 1e-6 || direction[1] <= 0) return 0;
  const tilt = (tiltDegrees * Math.PI) / 180;
  const tanTilt = Math.tan(tilt);
  const tanProfile = direction[1] / along;
  const depth = lengthMeters * Math.cos(tilt);
  const height = lengthMeters * Math.sin(tilt);
  if (depth <= 0 || tanTilt + tanProfile <= 0) return 0;
  // Distance behind the front row's low edge where the shadow meets the panel.
  const reach = (height + depth * tanProfile + pitchMeters * tanTilt) / (tanTilt + tanProfile);
  return Math.min(1, Math.max(0, (reach - pitchMeters) / depth));
}

export type RowShade = { lengthMeters: number; pitchMeters: number };

// Annual beam exposure of a panel, relative units: sum over sun samples of
// incidence × clear-sky weight, minus building shadow and, for a panel behind
// another row, the share that row shades.
export function exposure(normal: Vec3, azimuthDegrees: number, tiltDegrees: number, visible: Uint8Array, samples: SunSample[], row?: RowShade): number {
  let score = 0;
  samples.forEach(({ direction, weight }, index) => {
    if (!visible[index]) return;
    const incidence = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
    if (incidence <= 0) return;
    const shaded = row ? rowShadeFraction(direction, azimuthDegrees, tiltDegrees, row.lengthMeters, row.pitchMeters) : 0;
    score += incidence * weight * (1 - shaded);
  });
  return score;
}

// Annual exposure of one unshaded panel at the best tilt facing due south:
// the 100% reference for per-panel efficiency.
export function idealPanelExposure(samples: SunSample[]): number {
  const visible = new Uint8Array(samples.length).fill(1);
  let best = 0;
  for (let tilt = 0; tilt <= 60; tilt += 2) best = Math.max(best, exposure(panelNormal(180, tilt), 180, tilt, visible, samples));
  return best;
}
