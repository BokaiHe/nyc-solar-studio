import type { ConceptPanel } from '@/lib/solar/types';
import type { PanelSize } from './geometry';
import type { Vec3 } from './roof-faces';
import { panelNormal, type Occluders } from './shading';

type PanelPose = Pick<ConceptPanel, 'position' | 'azimuthDegrees' | 'tiltDegrees' | 'landscape'>;

// Corners sit slightly inside the module so neighbors touching its edge do not count.
const CORNER_INSET = 0.96;
// Edge probes run this far above the panel surface: high enough to clear a
// gently sloping roof under a rack, low enough to catch any wall crossing it.
const EDGE_LIFT_METERS = 0.3;
const SURFACE_LIFT_METERS = 0.03;

const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];

// True when no building geometry — the roof's own walls and upper parts, or a
// neighbor — overlaps the panel's volume or sits right above it.
export function panelClear(panel: PanelPose, size: PanelSize, occluders: Occluders): boolean {
  const width = panel.landscape ? size.heightMeters : size.widthMeters;
  const length = panel.landscape ? size.widthMeters : size.heightMeters;
  const azimuth = (panel.azimuthDegrees * Math.PI) / 180;
  const tilt = (panel.tiltDegrees * Math.PI) / 180;
  const across: Vec3 = [Math.cos(azimuth), 0, Math.sin(azimuth)];
  // Down the panel toward the side it faces.
  const down: Vec3 = [Math.sin(azimuth) * Math.cos(tilt), -Math.sin(tilt), -Math.cos(azimuth) * Math.cos(tilt)];
  const normal = panelNormal(panel.azimuthDegrees, panel.tiltDegrees);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([side, slope]) =>
    add(add(panel.position, across, side * CORNER_INSET * width / 2), down, slope * CORNER_INSET * length / 2));

  const up: Vec3 = [0, 1, 0];
  for (const point of [...corners, panel.position]) {
    // Anything straight overhead, however high, means the panel is inside a
    // volume or under an overhang rather than on open roof.
    if (occluders.blocked(add(point, normal, SURFACE_LIFT_METERS), up)) return false;
  }
  const lifted = corners.map((corner) => add(corner, normal, EDGE_LIFT_METERS));
  const segments: Array<[Vec3, Vec3]> = [
    [lifted[0], lifted[1]], [lifted[1], lifted[2]], [lifted[2], lifted[3]], [lifted[3], lifted[0]],
    [lifted[0], lifted[2]], [lifted[1], lifted[3]],
  ];
  for (const [from, to] of segments) {
    const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const distance = Math.hypot(...delta);
    if (occluders.blocked(from, [delta[0] / distance, delta[1] / distance, delta[2] / distance], distance)) return false;
  }
  return true;
}
