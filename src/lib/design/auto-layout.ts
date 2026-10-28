import type { ConceptPanel, RoofModelData } from '@/lib/solar/types';
import { FLAT_ROOF_DEGREES, panelCenter, type PanelSize } from './geometry';
import { dominantAxisDegrees, extractRoofFaces, planeHeight, type RoofFace, type Vec3 } from './roof-faces';
import { annualSunSamples, exposure, Occluders, panelNormal } from './shading';
import type { LayoutParams } from './state';

export type LayoutResult = {
  panels: ConceptPanel[];
  // Positions that fit on the roof before shading and the panel limit.
  candidateCount: number;
  // Fits dropped because they fall below the exposure threshold.
  shadedCount: number;
};

type Mount = ConceptPanel['mount'];

type Candidate = {
  face: number;
  u: number;
  v: number;
  position: Vec3;
  azimuthDegrees: number;
  tiltDegrees: number;
  mount: Mount;
  score: number;
};

// Raster resolution of each roof face, meters.
const CELL = 0.2;
const COLUMN_GAP = { rack: 0.05, flush: 0.03 };
const FLUSH_ROW_GAP = 0.05;
// Roof geometry this much above a face blocks it (bulkheads, upper setbacks).
const BLOCKER_CLEARANCE = 0.3;
// Grid offsets tried along each axis; the fill with the most panels wins.
const PHASES = 6;
// Candidates within this distance on a face share one shading evaluation.
const SHADE_CACHE_METERS = 1.5;
// Without "include shaded", keep positions with at least this share of the
// best position's annual exposure, in the spirit of the common 80% TSRF rule.
// It drops podiums in a tower's shadow and slopes facing away from the sun.
export const MIN_EXPOSURE_RATIO = 0.8;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
// Loop instead of Math.min(...values): large roofs exceed the spread argument limit.
function range(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return [min, max];
}

// The compass direction flat-roof racks face: the building axis nearest the
// requested azimuth when aligning to the roof, otherwise the request itself.
export function rackAzimuth(requested: number, axisDegrees: number | null): number {
  if (axisDegrees === null) return requested;
  // An outline edge at angle θ (from east toward south) has bearing 90° + θ.
  const options = [0, 1, 2, 3].map((quarter) => (90 + axisDegrees + quarter * 90) % 360);
  return options.reduce((best, option) => angleBetween(option, requested) < angleBetween(best, requested) ? option : best);
}

type Frame = { origin: Vec3; across: Vec3; forward: Vec3; azimuthDegrees: number; tiltDegrees: number; mount: Mount };

function faceFrame(face: RoofFace, rackAzimuthDegrees: number, rackTiltDegrees: number): Frame {
  const flat = face.slopeDegrees < FLAT_ROOF_DEGREES;
  const azimuthDegrees = flat ? rackAzimuthDegrees : face.azimuthDegrees;
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  const heading: Vec3 = [Math.sin(azimuth), 0, -Math.cos(azimuth)];
  // In-plane direction toward the facing side; downslope on pitched faces.
  const along = dot(face.normal, heading);
  const forward = normalize([heading[0] - face.normal[0] * along, heading[1] - face.normal[1] * along, heading[2] - face.normal[2] * along]);
  return {
    origin: face.triangles[0][0],
    across: normalize(cross(face.normal, forward)),
    forward,
    azimuthDegrees,
    tiltDegrees: flat ? rackTiltDegrees : face.slopeDegrees,
    mount: flat ? 'rack' : 'flush',
  };
}

class FaceRaster {
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;
  private integral: Int32Array | null = null;

  constructor(readonly minU: number, readonly minV: number, maxU: number, maxV: number) {
    this.width = Math.max(1, Math.ceil((maxU - minU) / CELL));
    this.height = Math.max(1, Math.ceil((maxV - minV) / CELL));
    this.cells = new Uint8Array(this.width * this.height);
  }

  // Set every cell whose center lies inside the triangle.
  fill(a: [number, number], b: [number, number], c: [number, number], value: number) {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) return;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - this.minU) / CELL));
    const i1 = Math.min(this.width - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - this.minU) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - this.minV) / CELL));
    const j1 = Math.min(this.height - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - this.minV) / CELL));
    const sign = Math.sign(area);
    const edge = (p: [number, number], q: [number, number], x: number, y: number) => ((q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])) * sign;
    for (let j = j0; j <= j1; j += 1) {
      const y = this.minV + (j + 0.5) * CELL;
      for (let i = i0; i <= i1; i += 1) {
        const x = this.minU + (i + 0.5) * CELL;
        if (edge(a, b, x, y) >= 0 && edge(b, c, x, y) >= 0 && edge(c, a, x, y) >= 0) this.cells[j * this.width + i] = value;
      }
    }
  }

  // Keep only cells at least `setback` meters from any unusable cell or the raster edge.
  erode(setback: number) {
    if (setback <= 0) return;
    const { width, height, cells } = this;
    const distance = new Float32Array(width * height);
    const far = width + height;
    for (let index = 0; index < cells.length; index += 1) distance[index] = cells[index] ? far : 0;
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= width || j >= height ? 0 : distance[j * width + i]);
    for (let j = 0; j < height; j += 1) {
      for (let i = 0; i < width; i += 1) {
        const index = j * width + i;
        if (!distance[index]) continue;
        distance[index] = Math.min(distance[index], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + Math.SQRT2, at(i + 1, j - 1) + Math.SQRT2);
      }
    }
    for (let j = height - 1; j >= 0; j -= 1) {
      for (let i = width - 1; i >= 0; i -= 1) {
        const index = j * width + i;
        if (!distance[index]) continue;
        distance[index] = Math.min(distance[index], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + Math.SQRT2, at(i - 1, j + 1) + Math.SQRT2);
      }
    }
    // A cell next to an unusable one is about half a cell from the edge.
    for (let index = 0; index < cells.length; index += 1) {
      if (cells[index] && (distance[index] - 0.5) * CELL < setback) cells[index] = 0;
    }
  }

  // True when every cell overlapping the rectangle is usable.
  fits(u: number, v: number, sizeU: number, sizeV: number): boolean {
    if (!this.integral) {
      const { width, height, cells } = this;
      const sums = new Int32Array((width + 1) * (height + 1));
      for (let j = 0; j < height; j += 1) {
        let row = 0;
        for (let i = 0; i < width; i += 1) {
          row += cells[j * width + i];
          sums[(j + 1) * (width + 1) + i + 1] = sums[j * (width + 1) + i + 1] + row;
        }
      }
      this.integral = sums;
    }
    const i0 = Math.floor((u - this.minU) / CELL);
    const j0 = Math.floor((v - this.minV) / CELL);
    const i1 = Math.ceil((u + sizeU - this.minU) / CELL);
    const j1 = Math.ceil((v + sizeV - this.minV) / CELL);
    if (i0 < 0 || j0 < 0 || i1 > this.width || j1 > this.height) return false;
    const stride = this.width + 1;
    const sums = this.integral;
    const total = sums[j1 * stride + i1] - sums[j0 * stride + i1] - sums[j1 * stride + i0] + sums[j0 * stride + i0];
    return total === (i1 - i0) * (j1 - j0);
  }
}

function faceCandidates(faces: RoofFace[], index: number, frame: Frame, params: LayoutParams, panel: PanelSize): Candidate[] {
  const face = faces[index];
  const toUV = (p: Vec3): [number, number] => {
    const offset: Vec3 = [p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]];
    return [dot(frame.across, offset), dot(frame.forward, offset)];
  };
  const uv = face.triangles.map((triangle) => triangle.map(toUV));
  const [minU, maxU0] = range(uv.flat().map((point) => point[0]));
  const [minV, maxV0] = range(uv.flat().map((point) => point[1]));
  // One cell of padding keeps the raster edge outside the roof.
  const raster = new FaceRaster(minU - CELL, minV - CELL, maxU0 + CELL, maxV0 + CELL);
  for (const [a, b, c] of uv) raster.fill(a, b, c, 1);

  // Block wherever another roof surface rises above this face.
  const [minX, maxX] = range(face.triangles.flat().map((point) => point[0]));
  const [minZ, maxZ] = range(face.triangles.flat().map((point) => point[2]));
  faces.forEach((other, otherIndex) => {
    if (otherIndex === index) return;
    for (const triangle of other.triangles) {
      if (triangle.every((p) => p[0] < minX) || triangle.every((p) => p[0] > maxX)
        || triangle.every((p) => p[2] < minZ) || triangle.every((p) => p[2] > maxZ)) continue;
      const cx = (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3;
      const cy = (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3;
      const cz = (triangle[0][2] + triangle[1][2] + triangle[2][2]) / 3;
      if (cy < planeHeight(face, cx, cz) + BLOCKER_CLEARANCE) continue;
      const [a, b, c] = triangle.map((p) => toUV([p[0], planeHeight(face, p[0], p[2]), p[2]]));
      raster.fill(a, b, c, 0);
    }
  });
  raster.erode(params.setbackMeters);

  const length = panel.heightMeters;
  const width = panel.widthMeters;
  const tilt = (frame.tiltDegrees * Math.PI) / 180;
  const depth = frame.mount === 'rack' ? length * Math.cos(tilt) : length;
  const columnPitch = width + COLUMN_GAP[frame.mount];
  const rowPitch = frame.mount === 'rack' ? depth + params.rowSpacingMeters : length + FLUSH_ROW_GAP;
  const maxU = raster.minU + raster.width * CELL;
  const maxV = raster.minV + raster.height * CELL;

  let best: Array<[number, number]> = [];
  for (let phaseV = 0; phaseV < PHASES; phaseV += 1) {
    for (let phaseU = 0; phaseU < PHASES; phaseU += 1) {
      const placed: Array<[number, number]> = [];
      for (let v = raster.minV + (phaseV / PHASES) * rowPitch; v + depth <= maxV; v += rowPitch) {
        for (let u = raster.minU + (phaseU / PHASES) * columnPitch; u + width <= maxU; u += columnPitch) {
          if (raster.fits(u, v, width, depth)) placed.push([u + width / 2, v + depth / 2]);
        }
      }
      if (placed.length > best.length) best = placed;
    }
  }

  const up: Vec3 = [0, 1, 0];
  return best.map(([u, v]) => {
    const onPlane: Vec3 = [
      frame.origin[0] + frame.across[0] * u + frame.forward[0] * v,
      frame.origin[1] + frame.across[1] * u + frame.forward[1] * v,
      frame.origin[2] + frame.across[2] * u + frame.forward[2] * v,
    ];
    return {
      face: index,
      u,
      v,
      position: panelCenter(onPlane, frame.mount === 'flush' ? face.normal : up, frame.mount, frame.tiltDegrees, length),
      azimuthDegrees: frame.azimuthDegrees,
      tiltDegrees: frame.tiltDegrees,
      mount: frame.mount,
      score: 0,
    };
  });
}

// Fill each roof face with a tidy grid aligned to the building, then keep the
// positions with good annual sun exposure (self-shading by the building only).
export function autoLayout(
  model: Pick<RoofModelData, 'positions' | 'indices' | 'wallPositions' | 'wallIndices' | 'center'>,
  params: LayoutParams,
  panel: PanelSize,
): LayoutResult {
  const faces = extractRoofFaces(model);
  if (!faces.length) return { panels: [], candidateCount: 0, shadedCount: 0 };
  const azimuth = rackAzimuth(params.azimuthDegrees, params.alignToRoof ? dominantAxisDegrees(faces) : null);
  const minimumArea = panel.widthMeters * panel.heightMeters;
  const candidates = faces.flatMap((face, index) => face.areaSquareMeters < minimumArea
    ? []
    : faceCandidates(faces, index, faceFrame(face, azimuth, params.tiltDegrees), params, panel));

  const samples = annualSunSamples(model.center);
  const occluders = new Occluders([model.positions, model.wallPositions], [model.indices, model.wallIndices]);
  const cache = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.face}:${Math.round(candidate.u / SHADE_CACHE_METERS)}:${Math.round(candidate.v / SHADE_CACHE_METERS)}`;
    let score = cache.get(key);
    if (score === undefined) {
      score = exposure(candidate.position, panelNormal(candidate.azimuthDegrees, candidate.tiltDegrees), samples, occluders).score;
      cache.set(key, score);
    }
    candidate.score = score;
  }

  const bestScore = range([0, ...candidates.map((candidate) => candidate.score)])[1];
  const exposed = params.includeShaded
    ? candidates
    : candidates.filter((candidate) => candidate.score >= bestScore * MIN_EXPOSURE_RATIO);
  const chosen = params.maxPanels > 0
    ? [...exposed].sort((a, b) => b.score - a.score).slice(0, params.maxPanels)
    : exposed;
  chosen.sort((a, b) => a.face - b.face || a.v - b.v || a.u - b.u);

  return {
    panels: chosen.map((candidate, index) => ({
      id: index + 1,
      position: candidate.position,
      azimuthDegrees: candidate.azimuthDegrees,
      tiltDegrees: candidate.tiltDegrees,
      landscape: false,
      mount: candidate.mount,
    })),
    candidateCount: candidates.length,
    shadedCount: candidates.length - exposed.length,
  };
}
