import * as THREE from 'three';

export type PanelSize = { widthMeters: number; heightMeters: number };

// Google Solar's default module when no Building Insights are available.
export const DEFAULT_PANEL_SIZE: PanelSize = { widthMeters: 1.045, heightMeters: 1.879 };
export const DEFAULT_PANEL_WATTS = 400;
// Rack panels keep their low edge this far above the roof.
export const PANEL_MOUNT_HEIGHT = 0.16;
// Flush panels sit this far off the roof plane, measured along its normal.
export const FLUSH_GAP = 0.08;
// Roof faces flatter than this get tilted racks; steeper ones get flush panels.
export const FLAT_ROOF_DEGREES = 8;

// Scene x is east and z is south, so a panel facing compass azimuth A is
// yawed by 180° - A before tilting about its own x axis ('YXZ' order).
export function panelYaw(azimuthDegrees: number): number {
  return THREE.MathUtils.degToRad(180 - azimuthDegrees);
}

// Height of a rack panel's center above the roof under it.
export function rackCenterHeight(tiltDegrees: number, lengthMeters: number): number {
  return PANEL_MOUNT_HEIGHT + (lengthMeters / 2) * Math.sin(THREE.MathUtils.degToRad(tiltDegrees));
}

// Panel center for a roof point with the given unit normal.
export function panelCenter(
  point: [number, number, number],
  normal: [number, number, number],
  mount: 'rack' | 'flush',
  tiltDegrees: number,
  lengthMeters: number,
): [number, number, number] {
  if (mount === 'flush') return [point[0] + normal[0] * FLUSH_GAP, point[1] + normal[1] * FLUSH_GAP, point[2] + normal[2] * FLUSH_GAP];
  return [point[0], point[1] + rackCenterHeight(tiltDegrees, lengthMeters), point[2]];
}

export function createSurfaceGeometry(positions: number[], indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}


export function roofTopHeight(positions: number[]): number {
  let top = 0;
  for (let index = 1; index < positions.length; index += 3) top = Math.max(top, positions[index]);
  return top;
}
