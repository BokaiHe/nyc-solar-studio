import type { ConceptPanel } from '@/lib/solar/types';
import type { PanelSize } from './geometry';
import type { Vec3 } from './roof-faces';

// An area of the roof drawn by the user where no panel may go: rooftop
// equipment, hatches, walkways. Points are roof hits in scene coordinates.
export type KeepOutZone = { id: number; points: Vec3[] };

// A zone applies to roof surfaces within this height of where it was drawn,
// so a zone on a podium does not also clear the tower roof above it.
export const ZONE_HEIGHT_TOLERANCE_METERS = 2;

// Even-odd test in the horizontal (x, z) plane.
export function insidePolygon(x: number, z: number, points: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, zi] = points[i];
    const [xj, zj] = points[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const zoneHeight = (zone: KeepOutZone) => zone.points.reduce((sum, point) => sum + point[1], 0) / zone.points.length;

const footprint = (zone: KeepOutZone) => zone.points.map(([x, , z]) => [x, z] as const);

// Horizontal corners of a panel's footprint.
function panelCorners(panel: Pick<ConceptPanel, 'position' | 'azimuthDegrees' | 'tiltDegrees' | 'landscape'>, size: PanelSize): Array<[number, number]> {
  const width = panel.landscape ? size.heightMeters : size.widthMeters;
  const length = panel.landscape ? size.widthMeters : size.heightMeters;
  const azimuth = (panel.azimuthDegrees * Math.PI) / 180;
  const depth = length * Math.cos((panel.tiltDegrees * Math.PI) / 180);
  const across = [Math.cos(azimuth), Math.sin(azimuth)];
  const forward = [Math.sin(azimuth), -Math.cos(azimuth)];
  const [x, , z] = panel.position;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, f]) => [
    x + (across[0] * a * width) / 2 + (forward[0] * f * depth) / 2,
    z + (across[1] * a * width) / 2 + (forward[1] * f * depth) / 2,
  ]);
}

// True when a panel's footprint overlaps a zone drawn at about its height.
export function panelInZones(panel: Pick<ConceptPanel, 'position' | 'azimuthDegrees' | 'tiltDegrees' | 'landscape'>, size: PanelSize, zones: KeepOutZone[]): boolean {
  if (!zones.length) return false;
  const corners = panelCorners(panel, size);
  return zones.some((zone) => {
    if (Math.abs(zoneHeight(zone) - panel.position[1]) > ZONE_HEIGHT_TOLERANCE_METERS) return false;
    const outline = footprint(zone);
    return [[panel.position[0], panel.position[2]] as [number, number], ...corners].some(([x, z]) => insidePolygon(x, z, outline))
      || outline.some(([x, z]) => insidePolygon(x, z, corners))
      || edgesCross(outline, corners);
  });
}

// Any edge of one closed polygon crossing an edge of the other (a thin zone
// can cut through a panel with no corner of either inside the other).
function edgesCross(a: ReadonlyArray<readonly [number, number]>, b: ReadonlyArray<readonly [number, number]>): boolean {
  const side = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  for (let i = 0; i < a.length; i += 1) {
    const p1 = a[i], p2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const q1 = b[j], q2 = b[(j + 1) % b.length];
      if (side(p1, p2, q1) * side(p1, p2, q2) < 0 && side(q1, q2, p1) * side(q1, q2, p2) < 0) return true;
    }
  }
  return false;
}

// Zones of at least three points with finite coordinates, from storage or a link.
export function validZones(value: unknown): value is KeepOutZone[] {
  return Array.isArray(value) && value.every((zone) => !!zone && typeof zone === 'object'
    && Number.isInteger((zone as KeepOutZone).id)
    && Array.isArray((zone as KeepOutZone).points) && (zone as KeepOutZone).points.length >= 3
    && (zone as KeepOutZone).points.every((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)));
}
