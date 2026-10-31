import { describe, expect, it } from 'vitest';
import { autoLayout, createLayoutContext } from './auto-layout';
import { BALANCED_MIN_EFFICIENCY, optimizeLayout } from './optimizer';
import { Occluders, rowShadeFraction } from './shading';
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

describe('surrounding buildings', () => {
  // A 60 m tower 6 m south of the roof's edge, as a neighbor mesh in the scene frame.
  function towerSouth() {
    const [x0, x1, z0, z1, top] = [-15, 15, 16, 30, 60];
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const positions: number[] = [];
    const indices: number[] = [];
    corners.forEach(([ax, az], index) => {
      const [bx, bz] = corners[(index + 1) % 4];
      const base = positions.length / 3;
      positions.push(ax, 0, az, bx, 0, bz, bx, top, bz, ax, top, az);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const base = positions.length / 3;
    positions.push(x0, top, z0, x1, top, z0, x1, top, z1, x0, top, z1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return { positions, indices, buildingStarts: [0], buildingCount: 1, radiusMeters: 200 };
  }

  it('skips box groups a ray cannot reach and still finds hits inside them', () => {
    const neighbor = towerSouth();
    const occluders = new Occluders([{ positions: neighbor.positions, indices: neighbor.indices }]);
    // Low sun to the south is blocked; a ray to the north is not.
    expect(occluders.blocked([0, 11, 0], [0, 0.3, 0.95])).toBe(true);
    expect(occluders.blocked([0, 11, 0], [0, 0.3, -0.95])).toBe(false);
  });

  it('drops roof spots in a tall neighbor’s shadow', () => {
    const roof = flatRoof();
    const alone = autoLayout(roof, DEFAULT_PARAMS, panel);
    const shaded = autoLayout(roof, DEFAULT_PARAMS, panel, createLayoutContext(roof, towerSouth()));
    expect(shaded.panels.length).toBeLessThan(alone.panels.length);
    expect(shaded.shadedCount).toBeGreaterThan(alone.shadedCount);
    // The rows nearest the tower (largest z) go first.
    const southmost = (panels: typeof alone.panels) => Math.max(...panels.map((placed) => placed.position[2]));
    expect(southmost(shaded.panels)).toBeLessThan(southmost(alone.panels));
  });
});
