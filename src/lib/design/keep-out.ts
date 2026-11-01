import type { ConceptPanel } from '@/lib/solar/types';
import type { PanelSize } from './geometry';
import { ShapeUtils, Vector2 } from 'three';
import { planeHeight, type RoofFace, type Vec3 } from './roof-faces';

// An area of the roof where no panel may go: rooftop equipment, hatches,
// walkways. Points are roof hits in scene coordinates. `auto` marks one found
// in the imagery and not edited since; detecting again replaces those.
export type KeepOutZone = { id: number; points: Vec3[]; auto?: boolean };

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

// Zones retain roof-hit heights. Triangulation preserves those local heights
// on slopes and concave outlines; immutable point arrays can reuse the result.
const triangleCache = new WeakMap<Vec3[], Vec3[][]>();
function zoneTriangles(zone: KeepOutZone): Vec3[][] {
  let triangles = triangleCache.get(zone.points);
  if (!triangles) {
    triangles = ShapeUtils.triangulateShape(zone.points.map(([x, , z]) => new Vector2(x, z)), [])
      .map((indices) => indices.map((index) => zone.points[index]));
    triangleCache.set(zone.points, triangles);
  }
  return triangles;
}

// Clip a convex polygon to a linear half-space, interpolating all three axes.
function clip(points: Vec3[], distance: (point: Vec3) => number): Vec3[] {
  const result: Vec3[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    const da = distance(a), db = distance(b);
    if (da >= 0) result.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
    }
  }
  return result;
}

// Only project portions whose local height agrees with this roof plane.
// A long slope can change elevation by many meters without leaving its roof.
export function zonePolygonsOnFace(zone: KeepOutZone, face: Pick<RoofFace, 'normal' | 'offset'>): Vec3[][] {
  const gap = ([x, y, z]: Vec3) => y - planeHeight(face, x, z);
  return zoneTriangles(zone).map((triangle) => clip(
    clip(triangle, (point) => ZONE_HEIGHT_TOLERANCE_METERS - gap(point)),
    (point) => ZONE_HEIGHT_TOLERANCE_METERS + gap(point),
  )).filter((polygon) => polygon.length >= 3);
}

const footprint = (zone: KeepOutZone) => zone.points.map(([x, , z]) => [x, z] as const);

// Plan area in square meters (shoelace formula).
export function zoneArea(zone: KeepOutZone): number {
  const points = footprint(zone);
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[(index + 1) % points.length];
    twice += x1 * z2 - x2 * z1;
  }
  return Math.abs(twice) / 2;
}

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
  const azimuth = panel.azimuthDegrees * Math.PI / 180;
  const slope = Math.tan(panel.tiltDegrees * Math.PI / 180);
  // Corners run clockwise in the x/z plane. Clip against all four edges,
  // including thin crossings with no original vertex inside either polygon.
  return zones.some((zone) => zoneTriangles(zone).some((triangle) => {
    let overlap = triangle;
    for (let i = 0; i < corners.length && overlap.length; i += 1) {
      const a = corners[i], b = corners[(i + 1) % corners.length];
      overlap = clip(overlap, ([x, , z]) => (b[1] - a[1]) * (x - a[0]) - (b[0] - a[0]) * (z - a[1]));
    }
    if (!overlap.length) return false;
    const gaps = overlap.map(([x, y, z]) => panel.position[1]
      - slope * ((x - panel.position[0]) * Math.sin(azimuth) - (z - panel.position[2]) * Math.cos(azimuth)) - y);
    return Math.min(...gaps) <= ZONE_HEIGHT_TOLERANCE_METERS && Math.max(...gaps) >= -ZONE_HEIGHT_TOLERANCE_METERS;
  }));
}

// Zones of at least three points with finite coordinates, from storage or a link.
export function validZones(value: unknown): value is KeepOutZone[] {
  return Array.isArray(value) && value.every((zone) => !!zone && typeof zone === 'object'
    && Number.isInteger((zone as KeepOutZone).id)
    && Array.isArray((zone as KeepOutZone).points) && (zone as KeepOutZone).points.length >= 3
    && (zone as KeepOutZone).points.every((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)));
}
