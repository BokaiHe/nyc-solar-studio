import { describe, expect, it } from 'vitest';
import { getSunSnapshot, newYorkDateTimeToDate, panelDirectLightFactor, sunPathForDate } from './sun';

describe('solar time and geometry', () => {
  it('converts New York local noon with daylight-saving time', () => {
    expect(newYorkDateTimeToDate('2026-06-21', 720).toISOString()).toBe('2026-06-21T16:00:00.000Z');
    expect(newYorkDateTimeToDate('2026-12-21', 720).toISOString()).toBe('2026-12-21T17:00:00.000Z');
  });

  it('places the summer-solstice sun high over New York at local noon', () => {
    const sun = getSunSnapshot(newYorkDateTimeToDate('2026-06-21', 720), 40.7128, -74.006);
    expect(sun.daylight).toBe(true);
    expect(sun.altitudeDegrees).toBeGreaterThan(65);
    expect(sun.azimuthDegrees).toBeGreaterThan(120);
    expect(sun.azimuthDegrees).toBeLessThan(210);
  });

  it('gives a south-facing tilted panel stronger noon incidence than a vertical north face', () => {
    const sun = getSunSnapshot(newYorkDateTimeToDate('2026-03-20', 720), 40.7128, -74.006);
    expect(panelDirectLightFactor(180, 35, sun)).toBeGreaterThan(panelDirectLightFactor(0, 90, sun));
  });

  it('builds a daylight-only daily trajectory', () => {
    const date = newYorkDateTimeToDate('2026-06-21', 720);
    const path = sunPathForDate(date, 40.7128, -74.006, 30);
    expect(path.length).toBeGreaterThan(20);
    expect(path.every((point) => point.altitudeDegrees > 0)).toBe(true);
  });
});
