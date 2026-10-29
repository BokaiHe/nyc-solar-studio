import { describe, expect, it } from 'vitest';
import { autoLayout } from './auto-layout';
import { BALANCED_MIN_EFFICIENCY, optimizeLayout } from './optimizer';
import { rowShadeFraction } from './shading';
import { DEFAULT_PARAMS } from './state';

// A flat 30 m × 20 m roof at 10 m with walls, centered on the origin.
function flatRoof() {
  const ring = [[-15, 10, -10], [15, 10, -10], [15, 10, 10], [-15, 10, 10]];
  const wallPositions: number[] = [];
  const wallIndices: number[] = [];
  ring.forEach((a, index) => {
    const b = ring[(index + 1) % 4];
    const base = wallPositions.length / 3;
    wallPositions.push(a[0], 0, a[2], b[0], 0, b[2], b[0], 10, b[2], a[0], 10, a[2]);
    wallIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions: ring.flat(), indices: [0, 1, 2, 0, 2, 3], wallPositions, wallIndices, center: { latitude: 40.7, longitude: -74 } };
}

const panel = { widthMeters: 1, heightMeters: 1.8 };
// Sun due south (+z) at 30° altitude.
const southSun: [number, number, number] = [0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];

describe('rowShadeFraction', () => {
  it('is zero for flat panels, sun behind the panel, or wide rows', () => {
    expect(rowShadeFraction(southSun, 180, 0, 1.8, 1.8)).toBe(0);
    expect(rowShadeFraction([0, 0.5, -0.86], 180, 20, 1.8, 2)).toBe(0);
    expect(rowShadeFraction(southSun, 180, 10, 1.8, 10)).toBe(0);
  });

  it('matches tan(tilt) / (tan(tilt) + tan(profile)) for rows with no gap', () => {
    const tilt = 32;
    const depth = 1.8 * Math.cos((tilt * Math.PI) / 180);
    const tanTilt = Math.tan((tilt * Math.PI) / 180);
    const tanProfile = Math.tan(Math.PI / 6);
    expect(rowShadeFraction(southSun, 180, tilt, 1.8, depth)).toBeCloseTo(tanTilt / (tanTilt + tanProfile));
  });

  it('shrinks as the row gap grows', () => {
    const tight = rowShadeFraction(southSun, 180, 25, 1.8, 2);
    const loose = rowShadeFraction(southSun, 180, 25, 1.8, 3);
    expect(tight).toBeGreaterThan(loose);
  });
});

describe('row shading in auto layout', () => {
  it('drops back rows of steep racks packed with no gap', () => {
    const steep = autoLayout(flatRoof(), { ...DEFAULT_PARAMS, tiltDegrees: 32, rowSpacingMeters: 0 }, panel);
    expect(steep.shadedCount).toBeGreaterThan(0);
    const kept = new Set(steep.panels.map((placed) => Math.round(placed.position[2] * 10)));
    // Only the front (southernmost) row keeps full sun.
    expect(kept.size).toBe(1);
  });
});

describe('optimizeLayout', () => {
  it('returns the settings with the most total energy, ranked', () => {
    const roof = flatRoof();
    const { current, options } = optimizeLayout(roof, DEFAULT_PARAMS, panel, 'max-total');
    expect(options).toHaveLength(3);
    expect(options[0].yieldIndex).toBeGreaterThan(current.yieldIndex);
    expect(options[0].yieldIndex).toBeGreaterThanOrEqual(options[1].yieldIndex);
    expect(options[1].yieldIndex).toBeGreaterThanOrEqual(options[2].yieldIndex);
    // Dense rows trade some per-panel yield for more panels.
    expect(options[0].efficiency).toBeLessThan(0.95);
    expect(options[0].params.rowSpacingMeters).toBeLessThanOrEqual(0.6);
  });

  it('keeps per-panel efficiency above the floor when balanced', () => {
    const progress: number[] = [];
    const { options } = optimizeLayout(flatRoof(), DEFAULT_PARAMS, panel, 'balanced', (done) => progress.push(done));
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(option.efficiency).toBeGreaterThanOrEqual(BALANCED_MIN_EFFICIENCY);
    expect(progress.at(-1)).toBe(42);
  });
});
