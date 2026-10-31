import { describe, expect, it } from 'vitest';
import type { CityBuilding } from './geometry';
import { decodeModelTile, decodeOutlineTile, encodeModelTile, encodeOutlineTile, tileIndex, tileKey } from './tile-format';

const building: CityBuilding = {
  id: 'gml_TEST', bin: '1000001', address: '1 TEST STREET', geometrySource: 'test',
  lower: [300000.12, 60000.34, 5.5], upper: [300020.12, 60030.34, 25.75],
  surfaces: [
    { type: 'RoofSurface', rings: [[[300000.12, 60000.34, 25.75], [300020.12, 60000.34, 25.75], [300020.12, 60030.34, 25.75], [300000.12, 60030.34, 25.75]]] },
    { type: 'GroundSurface', rings: [[[300000.12, 60000.34, 5.5], [300020.12, 60000.34, 5.5], [300020.12, 60030.34, 5.5]], [[300001, 60001, 5.5], [300002, 60001, 5.5], [300002, 60002, 5.5]]] },
  ],
};

describe('static tiles', () => {
  it('round-trips building models to the centimeter', () => {
    const [decoded] = decodeModelTile(encodeModelTile([building]));
    expect(decoded.id).toBe(building.id);
    expect(decoded.address).toBe(building.address);
    expect(decoded.surfaces.map((surface) => surface.type)).toEqual(['RoofSurface', 'GroundSurface']);
    expect(decoded.surfaces[1].rings).toHaveLength(2);
    decoded.surfaces.flatMap((surface) => surface.rings.flat()).forEach((point, index) => {
      const original = building.surfaces.flatMap((surface) => surface.rings.flat())[index];
      point.forEach((value, axis) => expect(Math.abs(value - original[axis])).toBeLessThanOrEqual(0.006));
    });
    expect(decoded.lower[0]).toBeCloseTo(300000.12, 2);
  });

  it('keeps very large buildings within range by coarsening their unit', () => {
    const long = { ...building, surfaces: [{ type: 'RoofSurface', rings: [[[300000, 60000, 10], [301500, 60000, 10], [301500, 60010, 10]]] }] } as CityBuilding;
    const [decoded] = decodeModelTile(encodeModelTile([long]));
    expect(decoded.surfaces[0].rings[0][1][0]).toBeCloseTo(301500, 1);
  });

  it('round-trips outlines and maps points to grid cells', () => {
    const outline = { id: 'gml_TEST', height: 20.3, address: null, rings: [[-73.9405, 40.7425, -73.9401, 40.7425, -73.9401, 40.7429]] };
    const [decoded] = decodeOutlineTile(encodeOutlineTile([outline]));
    expect(decoded.height).toBe(20.3);
    expect(decoded.address).toBeNull();
    decoded.rings[0].forEach((value, index) => expect(value).toBeCloseTo(outline.rings[0][index], 6));
    expect(tileKey(...tileIndex(-73.9405, 40.7425))).toBe('-24647_16297');
  });
});
