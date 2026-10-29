import { describe, expect, it } from 'vitest';
import { insideStudyArea, STUDY_AREA_BUILDINGS } from './study-area';

describe('study area', () => {
  it('covers the five boroughs and excludes nearby New Jersey and Long Island', () => {
    expect(STUDY_AREA_BUILDINGS).toBeGreaterThan(1_000_000);
    for (const inside of [
      { latitude: 40.7580, longitude: -73.9855 }, // Midtown Manhattan
      { latitude: 40.6782, longitude: -73.9442 }, // Brooklyn
      { latitude: 40.7282, longitude: -73.7949 }, // Queens
      { latitude: 40.8448, longitude: -73.8648 }, // Bronx
      { latitude: 40.5795, longitude: -74.1502 }, // Staten Island
    ]) expect(insideStudyArea(inside)).toBe(true);
    for (const outside of [
      { latitude: 40.7357, longitude: -74.1724 }, // Newark, NJ
      { latitude: 40.7891, longitude: -73.1350 }, // Suffolk County, Long Island
      { latitude: 40.55, longitude: -73.6 }, // Atlantic Ocean
    ]) expect(insideStudyArea(outside)).toBe(false);
  });
});
