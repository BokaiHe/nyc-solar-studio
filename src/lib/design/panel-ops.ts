import type { ConceptPanel } from '@/lib/solar/types';
import { COLUMN_GAP, FLUSH_ROW_GAP, type PanelSize } from './geometry';

type Position = [number, number, number];
type PanelPose = Pick<ConceptPanel, 'position' | 'azimuthDegrees' | 'tiltDegrees' | 'landscape' | 'mount'>;

const ORIENTATION_TOLERANCE_DEGREES = 1;
const SAME_LEVEL_METERS = 0.6;
const SAME_ROW_METERS = 0.3;
const SNAP_RADIUS_METERS = 3;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// Horizontal unit vectors in scene (x, z): `forward` toward the facing side,
// `across` along the row.
export function panelAxes(azimuthDegrees: number) {
  const azimuth = toRadians(azimuthDegrees);
  return {
    forward: [Math.sin(azimuth), -Math.cos(azimuth)] as [number, number],
    across: [Math.cos(azimuth), Math.sin(azimuth)] as [number, number],
  };
}

export function sameOrientation(a: PanelPose, b: PanelPose): boolean {
  return a.mount === b.mount
    && angleBetween(a.azimuthDegrees, b.azimuthDegrees) < ORIENTATION_TOLERANCE_DEGREES
    && Math.abs(a.tiltDegrees - b.tiltDegrees) < ORIENTATION_TOLERANCE_DEGREES;
}

// Distance from `point` to the plane a panel lies in (rack panels: their level).
function offPlane(anchor: PanelPose, point: Position): number {
  const dx = point[0] - anchor.position[0];
  const dy = point[1] - anchor.position[1];
  const dz = point[2] - anchor.position[2];
  if (anchor.mount === 'rack') return Math.abs(dy);
  const tilt = toRadians(anchor.tiltDegrees);
  const { forward } = panelAxes(anchor.azimuthDegrees);
  const normal = [forward[0] * Math.sin(tilt), Math.cos(tilt), forward[1] * Math.sin(tilt)];
  return Math.abs(dx * normal[0] + dy * normal[1] + dz * normal[2]);
}

// Panels on the same roof surface with the same orientation as `anchor`.
export function similarPanelIds(panels: ConceptPanel[], anchor: ConceptPanel): number[] {
  return panels
    .filter((panel) => sameOrientation(panel, anchor) && offPlane(anchor, panel.position) < SAME_LEVEL_METERS)
    .map((panel) => panel.id);
}

// Panels in the same row as `anchor`: same surface and the same position along
// the facing direction.
export function rowPanelIds(panels: ConceptPanel[], anchor: ConceptPanel): number[] {
  const { forward } = panelAxes(anchor.azimuthDegrees);
  const along = (panel: ConceptPanel) => panel.position[0] * forward[0] + panel.position[2] * forward[1];
  return panels
    .filter((panel) => sameOrientation(panel, anchor)
      && offPlane(anchor, panel.position) < SAME_LEVEL_METERS
      && Math.abs(along(panel) - along(anchor)) < SAME_ROW_METERS)
    .map((panel) => panel.id);
}

export function collides(position: Position, panels: ConceptPanel[], minSpacing: number, ignore?: ReadonlySet<number>): boolean {
  return panels.some((panel) => !ignore?.has(panel.id)
    && Math.hypot(panel.position[0] - position[0], panel.position[2] - position[2]) < minSpacing
    && Math.abs(panel.position[1] - position[1]) < 1);
}

// Snap a new panel onto the row/column grid of the nearest matching panel so
// hand-placed panels extend existing arrays neatly. Returns null when no
// panel with the same orientation is nearby.
export function snapToArray(candidate: PanelPose, panels: ConceptPanel[], size: PanelSize, rowSpacingMeters: number): Position | null {
  let anchor: ConceptPanel | null = null;
  let anchorDistance = SNAP_RADIUS_METERS;
  for (const panel of panels) {
    if (!sameOrientation(panel, candidate) || offPlane(panel, candidate.position) > SAME_LEVEL_METERS) continue;
    const distance = Math.hypot(panel.position[0] - candidate.position[0], panel.position[2] - candidate.position[2]);
    if (distance < anchorDistance) {
      anchor = panel;
      anchorDistance = distance;
    }
  }
  if (!anchor) return null;

  const width = candidate.landscape ? size.heightMeters : size.widthMeters;
  const length = candidate.landscape ? size.widthMeters : size.heightMeters;
  const tilt = toRadians(candidate.tiltDegrees);
  const acrossPitch = width + COLUMN_GAP[candidate.mount];
  // Row pitch along the slope, and its horizontal and vertical components.
  const slopePitch = candidate.mount === 'rack' ? length * Math.cos(tilt) + rowSpacingMeters : length + FLUSH_ROW_GAP;
  const horizontalPitch = candidate.mount === 'rack' ? slopePitch : slopePitch * Math.cos(tilt);
  const dropPerRow = candidate.mount === 'rack' ? 0 : slopePitch * Math.sin(tilt);

  const { forward, across } = panelAxes(anchor.azimuthDegrees);
  const dx = candidate.position[0] - anchor.position[0];
  const dz = candidate.position[2] - anchor.position[2];
  const columns = Math.round((dx * across[0] + dz * across[1]) / acrossPitch);
  const rows = Math.round((dx * forward[0] + dz * forward[1]) / horizontalPitch);
  return [
    anchor.position[0] + across[0] * columns * acrossPitch + forward[0] * rows * horizontalPitch,
    // Down the slope (toward the facing side) is lower.
    anchor.position[1] - rows * dropPerRow,
    anchor.position[2] + across[1] * columns * acrossPitch + forward[1] * rows * horizontalPitch,
  ];
}
