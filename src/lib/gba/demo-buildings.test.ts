import { describe, expect, it } from 'vitest';
import { findGbaDemoBuilding } from './demo-buildings';

describe('findGbaDemoBuilding', () => {
  it('matches the Google Solar center inside the verified GBA footprint', () => {
    expect(findGbaDemoBuilding({ latitude: 40.7281616, longitude: -73.7951012 })?.id)
      .toBe('osm248172169USA');
  });

  it('does not match an unrelated location', () => {
    expect(findGbaDemoBuilding({ latitude: 40.75, longitude: -73.98 })).toBeNull();
  });
});
