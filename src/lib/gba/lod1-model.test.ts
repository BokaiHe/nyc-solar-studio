import { describe, expect, it } from 'vitest';
import { buildGbaLod1Model } from './lod1-model';

describe('buildGbaLod1Model', () => {
  it('extrudes one clean flat-roof volume from a GBA footprint', () => {
    const model = buildGbaLod1Model({
      id: 'test-building',
      address: '',
      heightMeters: 12,
      heightVariance: 0.8,
      footprint: [
        { latitude: 40.7, longitude: -74.0 },
        { latitude: 40.7, longitude: -73.9999 },
        { latitude: 40.7001, longitude: -73.9999 },
        { latitude: 40.7001, longitude: -74.0 },
      ],
    });

    expect(model.buildingSource).toBe('GLOBAL_BUILDING_ATLAS_LOD1');
    expect(model.positions).toHaveLength(12);
    expect(model.indices).toHaveLength(6);
    expect(model.wallPositions).toHaveLength(48);
    expect(model.wallIndices).toHaveLength(24);
    expect(model.positions.filter((_, index) => index % 3 === 1)).toEqual([12, 12, 12, 12]);
    expect(model.widthMeters).toBeGreaterThan(8);
    expect(model.depthMeters).toBeGreaterThan(11);
  });
});
