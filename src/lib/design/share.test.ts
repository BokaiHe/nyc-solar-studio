import { describe, expect, it } from 'vitest';
import { encodeSharedDesign, parseSharedDesign, type SharedDesign } from './share';

const design: SharedDesign = {
  location: { latitude: 40.728161, longitude: -73.795099 },
  buildingId: 'gml_ABC123',
  panels: [
    { id: 1, position: [1.25, 12.4, -3.07], azimuthDegrees: 180, tiltDegrees: 10, landscape: false, mount: 'rack' },
    { id: 2, position: [-4, 12.41, 2.5], azimuthDegrees: 95, tiltDegrees: 32, landscape: true, mount: 'flush' },
  ],
  keepOut: [{ id: 1, points: [[0, 12.3, 0], [2.5, 12.3, 0], [2.5, 12.31, -1.5]] }],
};

describe('shared design links', () => {
  it('round-trips location, building and panels at centimeter precision', () => {
    const path = encodeSharedDesign(design);

    expect(path.startsWith('/b/?')).toBe(true);
    expect(parseSharedDesign(path.split('?')[1])).toEqual(design);
  });

  it('keeps an empty layout and skips malformed panels', () => {
    expect(parseSharedDesign('lat=40.7&lng=-74&bid=b1')?.panels).toEqual([]);
    expect(parseSharedDesign('lat=40.7&lng=-74&bid=b1&p3=100_0_0_180_10_0_0*bad*1_2_3_4_95_0_0')?.panels).toHaveLength(1);
  });

  it('rejects links without a valid location or building', () => {
    expect(parseSharedDesign('lat=x&lng=-74&bid=b1')).toBeNull();
    expect(parseSharedDesign('lat=40.7&lng=-74')).toBeNull();
    expect(parseSharedDesign('lng=-74&bid=b1')).toBeNull();
  });
});
