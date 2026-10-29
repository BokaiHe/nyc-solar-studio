import { describe, expect, it } from 'vitest';
import { buildNeighborMesh, type CityBuilding, type Point3 } from './geometry';

// Axis-aligned box buildings in EPSG:32118 meters (x east, y north, z up).
function box(id: string, x0: number, y0: number, x1: number, y1: number, top: number): CityBuilding {
  const ring = (z: number): Point3[] => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
  const wall = (a: Point3, b: Point3): Point3[] => [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], top], [a[0], a[1], top]];
  const roof = ring(top);
  return {
    id, bin: '', address: '', geometrySource: '',
    lower: [x0, y0, 0], upper: [x1, y1, top],
    surfaces: [
      { type: 'RoofSurface', rings: [roof] },
      { type: 'GroundSurface', rings: [ring(0)] },
      ...roof.map((corner, index) => ({ type: 'WallSurface', rings: [wall(corner, roof[(index + 1) % 4])] })),
    ],
  };
}

const target = box('target', 300000, 60000, 300020, 60020, 20);

describe('buildNeighborMesh', () => {
  it('keeps only neighbors that rise high enough for their distance', () => {
    const tallNear = box('tall', 300030, 60000, 300050, 60020, 80);
    const lowNear = box('low', 300000, 60030, 300020, 60050, 15);
    // 150 m away but only 5 m above the roof: under the 3° shading slope.
    const shortFar = box('far', 300170, 60000, 300190, 60020, 25);
    const mesh = buildNeighborMesh(target, [tallNear, lowNear, shortFar], 200);

    expect(mesh.buildingCount).toBe(1);
    expect(mesh.buildingStarts).toEqual([0]);
    // Ground faces are skipped and no kept face lies wholly below the roof.
    const ys = mesh.positions.filter((_, index) => index % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(80);
    expect(mesh.indices.length / 3).toBeGreaterThan(0);
  });

  it('places neighbors in the target frame: east is +x, north is -z', () => {
    const east = box('east', 300040, 60000, 300060, 60020, 60);
    const mesh = buildNeighborMesh(target, [east], 200);
    const xs = mesh.positions.filter((_, index) => index % 3 === 0);
    const zs = mesh.positions.filter((_, index) => index % 3 === 2);
    expect(Math.min(...xs)).toBeGreaterThan(20);
    expect(Math.max(...zs)).toBeLessThan(15);
    expect(Math.min(...zs)).toBeGreaterThan(-15);
  });
});
