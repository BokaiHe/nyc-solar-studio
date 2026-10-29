import { NYC_CLIMATE } from '../solar/nyc-climate';
import { getSunSnapshot } from '../solar/sun';
import type { LatLng } from '@/lib/solar/types';
import type { Vec3 } from './roof-faces';

// One representative hour of the year: the sun on the 21st of a month at a
// UTC hour, with that month-hour's mean weather from the typical year.
export type SunSample = {
  direction: Vec3;
  // Beam normal, diffuse horizontal and global horizontal irradiance, W/m².
  dni: number;
  dhi: number;
  ghi: number;
  airTemperature: number;
  // How many hours of the year this sample stands for.
  hours: number;
};

type Climate = typeof NYC_CLIMATE;

// Below this altitude beam light is ignored; grazing rays are unreliable.
const MIN_BEAM_ALTITUDE_DEGREES = 3;
const RAY_START_OFFSET = 0.3;
const EPSILON = 1e-7;

// PVWatts-style system assumptions.
export const SYSTEM_LOSSES = 0.14;
export const INVERTER_EFFICIENCY = 0.96;
const TEMPERATURE_COEFFICIENT = -0.0037;
// Cell temperature rise per W/m² of plane-of-array irradiance (≈ NOCT 45 °C).
const CELL_HEATING = 0.03;
const ROOF_ALBEDO = 0.2;
// Glass reflects more at grazing angles: ASHRAE incidence angle modifier for
// beam light, and typical fixed factors for diffuse and ground-reflected light.
const IAM_B0 = 0.05;
const DIFFUSE_IAM = 0.95;
const GROUND_IAM = 0.9;

export function annualSunSamples(location: LatLng, climate: Climate = NYC_CLIMATE, year = 2025): SunSample[] {
  const samples: SunSample[] = [];
  for (let month = 0; month < 12; month += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const ghi = climate.ghi[month][hour];
      if (ghi <= 0) continue;
      const sun = getSunSnapshot(new Date(Date.UTC(year, month, 21, hour, 30)), location.latitude, location.longitude);
      if (sun.altitudeDegrees <= 0) continue;
      const altitude = (sun.altitudeDegrees * Math.PI) / 180;
      const azimuth = (sun.azimuthDegrees * Math.PI) / 180;
      samples.push({
        // Scene x is east and z is south.
        direction: [Math.sin(azimuth) * Math.cos(altitude), Math.sin(altitude), -Math.cos(azimuth) * Math.cos(altitude)],
        dni: sun.altitudeDegrees >= MIN_BEAM_ALTITUDE_DEGREES ? climate.dni[month][hour] : 0,
        dhi: climate.dhi[month][hour],
        ghi,
        airTemperature: climate.airTemperature[month][hour],
        hours: climate.daysInMonth[month],
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

// Triangles grouped by building, each group with a bounding box, for fast
// "any hit" ray queries: a ray that misses a group's box skips its triangles.
export type OccluderMesh = { positions: number[]; indices: number[]; groupStarts?: number[] };

export class Occluders {
  private readonly data: Float32Array;
  private readonly groups: Array<{ from: number; to: number; min: Vec3; max: Vec3 }> = [];

  constructor(meshes: OccluderMesh[]) {
    const triangles: number[] = [];
    for (const { positions, indices, groupStarts = [0] } of meshes) {
      const starts = [...groupStarts, indices.length];
      for (let group = 0; group < starts.length - 1; group += 1) {
        const from = triangles.length / 9;
        const min: Vec3 = [Infinity, Infinity, Infinity];
        const max: Vec3 = [-Infinity, -Infinity, -Infinity];
        for (let t = starts[group]; t < starts[group + 1]; t += 1) {
          const v = indices[t] * 3;
          for (let axis = 0; axis < 3; axis += 1) {
            const value = positions[v + axis];
            triangles.push(value);
            if (value < min[axis]) min[axis] = value;
            if (value > max[axis]) max[axis] = value;
          }
        }
        const to = triangles.length / 9;
        if (to > from) this.groups.push({ from, to, min, max });
      }
    }
    this.data = Float32Array.from(triangles);
  }

  // Slab test: does the ray from `origin` along `direction` enter the box?
  private static hitsBox(origin: Vec3, direction: Vec3, min: Vec3, max: Vec3): boolean {
    let near = 0;
    let far = Infinity;
    for (let axis = 0; axis < 3; axis += 1) {
      const d = direction[axis];
      if (Math.abs(d) < 1e-12) {
        if (origin[axis] < min[axis] || origin[axis] > max[axis]) return false;
        continue;
      }
      let t1 = (min[axis] - origin[axis]) / d;
      let t2 = (max[axis] - origin[axis]) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      near = Math.max(near, t1);
      far = Math.min(far, t2);
      if (near > far) return false;
    }
    return true;
  }

  // Möller–Trumbore, returning on the first hit beyond the start offset.
  blocked(origin: Vec3, direction: Vec3): boolean {
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = direction;
    const d = this.data;
    for (const group of this.groups) {
      if (!Occluders.hitsBox(origin, direction, group.min, group.max)) continue;
      for (let t = group.from; t < group.to; t += 1) {
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
    }
    return false;
  }
}

// Directions over the sky dome with weights for diffuse light reaching a
// horizontal surface (isotropic sky: radiance × cos(zenith) × solid angle).
const SKY_DIRECTIONS: Array<{ direction: Vec3; weight: number }> = (() => {
  const rings = [10, 30, 50, 70];
  const steps = 12;
  const result: Array<{ direction: Vec3; weight: number }> = [];
  for (const degrees of rings) {
    const altitude = (degrees * Math.PI) / 180;
    const weight = Math.sin(altitude) * Math.cos(altitude);
    for (let step = 0; step < steps; step += 1) {
      const azimuth = ((step + (degrees / 20) % 1) / steps) * 2 * Math.PI;
      result.push({ direction: [Math.sin(azimuth) * Math.cos(altitude), Math.sin(altitude), -Math.cos(azimuth) * Math.cos(altitude)], weight });
    }
  }
  const total = result.reduce((sum, item) => sum + item.weight, 0);
  return result.map((item) => ({ ...item, weight: item.weight / total }));
})();

export type Visibility = {
  // Per sun sample: 1 when the sun is visible from the point.
  sun: Uint8Array;
  // Share of diffuse sky light not blocked by buildings, 0–1.
  sky: number;
};

// What a roof point sees of the sun and sky, cached on a coarse grid.
// Visibility depends only on position, so every layout tried for a roof can share it.
export class VisibilityCache {
  private readonly cache = new Map<string, Visibility>();

  constructor(readonly samples: SunSample[], private readonly occluders: Occluders, private readonly cellMeters = 1.5) {}

  at(position: Vec3): Visibility {
    const key = `${Math.round(position[0] / this.cellMeters)}:${Math.round(position[1] / 0.5)}:${Math.round(position[2] / this.cellMeters)}`;
    let visibility = this.cache.get(key);
    if (!visibility) {
      const origin: Vec3 = [position[0], position[1] + RAY_START_OFFSET, position[2]];
      visibility = {
        sun: Uint8Array.from(this.samples, ({ direction }) => (this.occluders.blocked(origin, direction) ? 0 : 1)),
        sky: SKY_DIRECTIONS.reduce((sum, { direction, weight }) => sum + (this.occluders.blocked(origin, direction) ? 0 : weight), 0),
      };
      this.cache.set(key, visibility);
    }
    return visibility;
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

// Sky view of a tilted panel: (1 + cos(tilt + ψ)) / 2, where ψ is the angle the
// row in front blocks above the horizon, seen from the panel's middle.
function skyViewFactor(tiltDegrees: number, row?: RowShade): number {
  const tilt = (tiltDegrees * Math.PI) / 180;
  let mask = 0;
  if (row) {
    const depth = row.lengthMeters * Math.cos(tilt);
    const height = row.lengthMeters * Math.sin(tilt);
    mask = Math.atan2(height / 2, Math.max(0.05, row.pitchMeters - depth / 2));
  }
  return (1 + Math.cos(tilt + mask)) / 2;
}

// Annual AC energy per kW of panel capacity (kWh/kWp) for a panel with the
// given orientation and view of sun and sky: beam, diffuse and roof-reflected
// light on the panel plane with incidence angle losses, a cell-temperature
// correction, then system losses and inverter efficiency.
export function annualYield(normal: Vec3, azimuthDegrees: number, tiltDegrees: number, visibility: Visibility, samples: SunSample[], row?: RowShade): number {
  const tilt = (tiltDegrees * Math.PI) / 180;
  const skyFactor = skyViewFactor(tiltDegrees, row) * visibility.sky;
  const groundFactor = ROOF_ALBEDO * (1 - Math.cos(tilt)) / 2;
  let dcKwhPerKw = 0;
  samples.forEach((sample, index) => {
    const { direction } = sample;
    let beam = 0;
    if (visibility.sun[index] && sample.dni > 0) {
      const incidence = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
      if (incidence > 0) {
        const shaded = row ? rowShadeFraction(direction, azimuthDegrees, tiltDegrees, row.lengthMeters, row.pitchMeters) : 0;
        const iam = Math.max(0, 1 - IAM_B0 * (1 / Math.max(incidence, 0.05) - 1));
        beam = sample.dni * incidence * iam * (1 - shaded);
      }
    }
    const planeOfArray = beam + sample.dhi * skyFactor * DIFFUSE_IAM + sample.ghi * groundFactor * GROUND_IAM;
    const cellTemperature = sample.airTemperature + planeOfArray * CELL_HEATING;
    // STC is 1000 W/m², so POA / 1000 is the output fraction of nameplate.
    dcKwhPerKw += (planeOfArray / 1000) * (1 + TEMPERATURE_COEFFICIENT * (cellTemperature - 25)) * sample.hours;
  });
  return dcKwhPerKw * (1 - SYSTEM_LOSSES) * INVERTER_EFFICIENCY;
}

const OPEN: Visibility = { sun: new Uint8Array(0), sky: 1 };

// Yield of one unshaded panel at the best tilt facing due south: the 100%
// reference for per-panel efficiency.
export function idealPanelYield(samples: SunSample[]): number {
  const visibility = { ...OPEN, sun: new Uint8Array(samples.length).fill(1) };
  let best = 0;
  for (let tilt = 0; tilt <= 60; tilt += 2) best = Math.max(best, annualYield(panelNormal(180, tilt), 180, tilt, visibility, samples));
  return best;
}
