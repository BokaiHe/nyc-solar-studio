import { describe, expect, it } from 'vitest';
import {
  encodeSharedDesign,
  parseSharedDesign,
  selectedIndicesFromSharedDesign,
  type SharedDesign,
} from './share-state';

const design: SharedDesign = {
  latitude: 40.7282,
  longitude: -73.7949,
  baseCount: 4,
  added: [6],
  removed: [1],
  imageryDate: { year: 2025, month: 7, day: 9 },
  panelCount: 10,
  camera: { heading: 25, tilt: 67, range: 260 },
};

describe('shared design state', () => {
  it('round-trips a design through the URL format', () => {
    const path = encodeSharedDesign(design);
    const parsed = parseSharedDesign(path.split('?')[1]);

    expect(parsed).toEqual(design);
  });

  it('reconstructs additions and removals within the candidate range', () => {
    const selected = selectedIndicesFromSharedDesign({
      ...design,
      added: [6, 99],
      removed: [1],
    });

    expect([...selected]).toEqual([0, 2, 3, 6]);
  });

  it('rejects malformed or internally inconsistent links', () => {
    expect(parseSharedDesign('lat=x&lng=-74')).toBeNull();
    expect(
      parseSharedDesign('lat=40.7&lng=-74&base=5&count=2&date=20250101&cam=0,67,260'),
    ).toBeNull();
  });
});
