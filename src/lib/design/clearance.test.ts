import { describe, expect, it } from 'vitest';
import type { ConceptPanel, NeighborMesh } from '@/lib/solar/types';
import { autoLayout, createLayoutContext } from './auto-layout';
import { panelClear } from './clearance';
import { panelInZones } from './keep-out';
import { Occluders } from './shading';
import { DEFAULT_PARAMS } from './state';

const size = { widthMeters: 1, heightMeters: 1.8 };
// A flat 30 m × 20 m roof at 10 m, centered on the origin, without walls.
const roof = { positions: [-15, 10, -10, 15, 10, -10, 15, 10, 10, -15, 10, 10], indices: [0, 1, 2, 0, 2, 3], wallPositions: [], wallIndices: [], center: { latitude: 40.7, longitude: -74 } };

// An axis-aligned box from height 0 to `top`, as a single-building neighbor mesh.
function boxMesh(x0: number, x1: number, z0: number, z1: number, top: number): NeighborMesh {
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const positions: number[] = [];
  const indices: number[] = [];
  corners.forEach(([ax, az], index) => {
    const [bx, bz] = corners[(index + 1) % 4];
    const base = positions.length / 3;
    positions.push(ax, 0, az, bx, 0, bz, bx, top, bz, ax, top, az);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const base = positions.length / 3;
  positions.push(x0, top, z0, x1, top, z0, x1, top, z1, x0, top, z1);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  return { positions, indices, buildingStarts: [0], buildingCount: 1, radiusMeters: 200 };
}

// Does a rack panel's footprint (inset like the check) reach into the box?
function overlapsBox(panel: ConceptPanel, [x0, x1, z0, z1]: number[]): boolean {
  const halfX = size.widthMeters / 2;
  const halfZ = (size.heightMeters * Math.cos((panel.tiltDegrees * Math.PI) / 180)) / 2;
  const [x, , z] = panel.position;
  return x + halfX > x0 && x - halfX < x1 && z + halfZ > z0 && z - halfZ < z1;
}

const rack = (x: number, z: number, y = 10.32): ConceptPanel => ({ id: 1, position: [x, y, z], azimuthDegrees: 180, tiltDegrees: 10, landscape: false, mount: 'rack' });

describe('panelClear', () => {
  it('passes an open roof and rejects a panel under an overhang or inside a volume', () => {
    const open = new Occluders([{ positions: roof.positions, indices: roof.indices }]);
    expect(panelClear(rack(0, 0), size, open)).toBe(true);

    const overhang = boxMesh(-2, 2, -2, 2, 12);
    // Lift the overhang's box off the roof: only its top face at 12 m remains above the panel.
    const above = new Occluders([{ positions: overhang.positions.slice(-12), indices: [0, 1, 2, 0, 2, 3] }]);
    expect(panelClear(rack(0, 0), size, above)).toBe(false);

    const tower = boxMesh(-2, 2, -2, 2, 40);
    const inside = new Occluders([{ positions: tower.positions, indices: tower.indices }]);
    expect(panelClear(rack(0, 0), size, inside)).toBe(false);
    expect(panelClear(rack(6, 0), size, inside)).toBe(true);
  });

  it('rejects a panel that a thin wall crosses', () => {
    const fin = boxMesh(-0.05, 0.05, -10, 10, 13);
    const wall = new Occluders([{ positions: fin.positions, indices: fin.indices }]);
    expect(panelClear(rack(0, 0), size, wall)).toBe(false);
    expect(panelClear(rack(1, 0), size, wall)).toBe(true);
  });
});

describe('auto layout collisions', () => {
  it('keeps panels out of a neighbor tower standing on the roof', () => {
    const footprint = [-3, 3, -4, 4];
    const tower = boxMesh(footprint[0], footprint[1], footprint[2], footprint[3], 40);
    const { panels } = autoLayout(roof, { ...DEFAULT_PARAMS, includeShaded: true }, size, createLayoutContext(roof, tower));
    expect(panels.length).toBeGreaterThan(30);
    expect(panels.filter((panel) => overlapsBox(panel, footprint))).toEqual([]);
  });

  it('never lets a wall cross a panel', () => {
    const fin = boxMesh(-0.05, 0.05, -10, 10, 13);
    const { panels } = autoLayout(roof, { ...DEFAULT_PARAMS, includeShaded: true }, size, createLayoutContext(roof, fin));
    expect(panels.length).toBeGreaterThan(30);
    expect(panels.filter((panel) => overlapsBox(panel, [-0.05, 0.05, -10, 10]))).toEqual([]);
  });
});

describe('keep-out zones', () => {
  const zone = { id: 1, points: [[-4, 10, -3], [4, 10, -3], [4, 10, 3], [-4, 10, 3]] as Array<[number, number, number]> };

  it('keeps auto layout out of a zone and its setback', () => {
    const params = { ...DEFAULT_PARAMS, includeShaded: true, keepOut: [zone] };
    const { panels } = autoLayout(roof, params, size, createLayoutContext(roof));
    const open = autoLayout(roof, { ...params, keepOut: [] }, size, createLayoutContext(roof)).panels;
    expect(panels.length).toBeGreaterThan(20);
    expect(panels.length).toBeLessThan(open.length);
    const reach = [-4 - DEFAULT_PARAMS.setbackMeters, 4 + DEFAULT_PARAMS.setbackMeters, -3 - DEFAULT_PARAMS.setbackMeters, 3 + DEFAULT_PARAMS.setbackMeters];
    expect(panels.filter((panel) => overlapsBox(panel, reach.map((value, index) => value + (index % 2 ? -0.25 : 0.25))))).toEqual([]);
    expect(panels.some((panel) => panelInZones(panel, size, [zone]))).toBe(false);
  });

  it('ignores a zone drawn on a different level', () => {
    const podium = { ...zone, points: zone.points.map(([x, , z]) => [x, 2, z] as [number, number, number]) };
    const params = { ...DEFAULT_PARAMS, includeShaded: true };
    const open = autoLayout(roof, params, size, createLayoutContext(roof)).panels;
    expect(autoLayout(roof, { ...params, keepOut: [podium] }, size, createLayoutContext(roof)).panels).toHaveLength(open.length);
  });

  it('flags a hand-placed panel overlapping a zone', () => {
    expect(panelInZones(rack(0, 0), size, [zone])).toBe(true);
    expect(panelInZones(rack(4.4, 0), size, [zone])).toBe(true);
    expect(panelInZones(rack(8, 0), size, [zone])).toBe(false);
  });
});
