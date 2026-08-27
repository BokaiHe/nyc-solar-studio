import { describe, expect, it } from 'vitest';
import { panelToPolygon } from './panel-to-polygon';
import type { LatLngAltitude, RoofSegmentStats, SolarPanel } from './types';

const EARTH_RADIUS_METERS = 6_378_137;
const DEG_TO_RAD = Math.PI / 180;
const center = { latitude: 40.58, longitude: -74.15 };
const dimensions = { widthM: 1.1, heightM: 1.7 };

function distance3d(a: LatLngAltitude, b: LatLngAltitude): number {
  const meanLatitude = ((a.latitude + b.latitude) / 2) * DEG_TO_RAD;
  const northM = (b.latitude - a.latitude) * DEG_TO_RAD * EARTH_RADIUS_METERS;
  const eastM =
    (b.longitude - a.longitude) *
    DEG_TO_RAD *
    EARTH_RADIUS_METERS *
    Math.cos(meanLatitude);
  return Math.hypot(eastM, northM, b.altitude - a.altitude);
}

function panel(orientation: SolarPanel['orientation']): SolarPanel {
  return {
    center,
    orientation,
    segmentIndex: 0,
    yearlyEnergyDcKwh: 500,
  };
}

function segment(pitchDegrees: number, azimuthDegrees: number): RoofSegmentStats {
  return {
    center,
    pitchDegrees,
    azimuthDegrees,
    planeHeightAtCenterMeters: 20,
  };
}

function expectDimensions(
  vertices: LatLngAltitude[],
  alongSlopeM: number,
  crossSlopeM: number,
) {
  expect(distance3d(vertices[0], vertices[1])).toBeCloseTo(crossSlopeM, 5);
  expect(distance3d(vertices[1], vertices[2])).toBeCloseTo(alongSlopeM, 5);
  expect(distance3d(vertices[0], vertices[2])).toBeCloseTo(
    Math.hypot(alongSlopeM, crossSlopeM),
    5,
  );
}

describe('panelToPolygon', () => {
  it('preserves dimensions on a flat roof', () => {
    const result = panelToPolygon(
      panel('PORTRAIT'),
      segment(0, 180),
      dimensions,
      'ABSOLUTE',
    );
    expectDimensions(result.vertices, dimensions.heightM, dimensions.widthM);
  });

  it('preserves dimensions on a south-facing pitched roof', () => {
    const result = panelToPolygon(
      panel('PORTRAIT'),
      segment(35, 180),
      dimensions,
      'ABSOLUTE',
    );
    expectDimensions(result.vertices, dimensions.heightM, dimensions.widthM);
  });

  it('preserves dimensions on an east-facing landscape roof', () => {
    const result = panelToPolygon(
      panel('LANDSCAPE'),
      segment(28, 90),
      dimensions,
      'ABSOLUTE',
    );
    expectDimensions(result.vertices, dimensions.widthM, dimensions.heightM);
  });
});
