import { describe, expect, it } from 'vitest';
import type { ConceptPanel } from '@/lib/solar/types';
import { autoLayout, rackAzimuth } from './auto-layout';
import { dominantAxisDegrees, extractRoofFaces } from './roof-faces';
import { DEFAULT_PARAMS, type LayoutParams } from './state';

type Point = [number, number, number];

// Minimal model builder: each roof polygon is one surface with its own
// vertices (as CityGML surfaces are), plus vertical walls down to the ground.
class ModelBuilder {
  positions: number[] = [];
  indices: number[] = [];
  wallPositions: number[] = [];
  wallIndices: number[] = [];
  center = { latitude: 40.7, longitude: -74 };

  roof(points: Point[]) {
    const base = this.positions.length / 3;
    this.positions.push(...points.flat());
    for (let i = 1; i < points.length - 1; i += 1) this.indices.push(base, base + i, base + i + 1);
    return this;
  }

  // Walls under every edge of a horizontal ring, from height 0 to the ring.
  walls(ring: Point[]) {
    ring.forEach((a, index) => {
      const b = ring[(index + 1) % ring.length];
      const base = this.wallPositions.length / 3;
      this.wallPositions.push(a[0], 0, a[2], b[0], 0, b[2], b[0], b[1], b[2], a[0], a[1], a[2]);
      this.wallIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    return this;
  }

  box(x0: number, x1: number, z0: number, z1: number, height: number) {
    const ring: Point[] = [[x0, height, z0], [x1, height, z0], [x1, height, z1], [x0, height, z1]];
    return this.roof(ring).walls(ring);
  }
}

const panel = { widthMeters: 1, heightMeters: 1.8 };
const params = (overrides: Partial<LayoutParams> = {}): LayoutParams => ({ ...DEFAULT_PARAMS, ...overrides });

// Ground footprint corners of a panel, for containment checks.
function footprint(placed: ConceptPanel): Array<[number, number]> {
  const azimuth = (placed.azimuthDegrees * Math.PI) / 180;
  const forward: [number, number] = [Math.sin(azimuth), -Math.cos(azimuth)];
  const across: [number, number] = [-forward[1], forward[0]];
  const depth = (panel.heightMeters * Math.cos((placed.tiltDegrees * Math.PI) / 180)) / 2;
  const half = panel.widthMeters / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, f]) => [
    placed.position[0] + across[0] * a * half + forward[0] * f * depth,
    placed.position[2] + across[1] * a * half + forward[1] * f * depth,
  ]);
}

describe('roof faces', () => {
  it('merges coplanar surfaces and finds the building axis of a rotated roof', () => {
    const angle = (30 * Math.PI) / 180;
    const rotate = ([x, y, z]: Point): Point => [x * Math.cos(angle) - z * Math.sin(angle), y, x * Math.sin(angle) + z * Math.cos(angle)];
    const model = new ModelBuilder()
      .roof(([[-10, 10, -10], [0, 10, -10], [0, 10, 10], [-10, 10, 10]] as Point[]).map(rotate))
      .roof(([[0, 10, -10], [10, 10, -10], [10, 10, 10], [0, 10, 10]] as Point[]).map(rotate));
    const faces = extractRoofFaces(model);

    expect(faces).toHaveLength(1);
    expect(faces[0].areaSquareMeters).toBeCloseTo(400);
    expect(dominantAxisDegrees(faces)).toBeCloseTo(30, 1);
  });

  it('snaps rack azimuth to the building axis nearest the request', () => {
    expect(rackAzimuth(180, 30)).toBeCloseTo(210);
    expect(rackAzimuth(180, 0)).toBeCloseTo(180);
    expect(rackAzimuth(200, null)).toBe(200);
  });
});

describe('autoLayout', () => {
  it('fills a flat roof inside the setback with south-facing racks', () => {
    const model = new ModelBuilder().box(-6, 6, -4, 4, 10);
    const { panels, shadedCount } = autoLayout(model, params(), panel);

    expect(panels.length).toBeGreaterThan(10);
    expect(shadedCount).toBe(0);
    for (const placed of panels) {
      expect(placed).toMatchObject({ mount: 'rack', azimuthDegrees: 180, tiltDegrees: 10 });
      for (const [x, z] of footprint(placed)) {
        expect(Math.abs(x)).toBeLessThanOrEqual(6 - DEFAULT_PARAMS.setbackMeters + 1e-6);
        expect(Math.abs(z)).toBeLessThanOrEqual(4 - DEFAULT_PARAMS.setbackMeters + 1e-6);
      }
    }
  });

  it('aligns rows to a rotated building and keeps every footprint on the roof', () => {
    const angle = (30 * Math.PI) / 180;
    const ring = ([[-10, 10, -8], [10, 10, -8], [10, 10, 8], [-10, 10, 8]] as Point[])
      .map(([x, y, z]): Point => [x * Math.cos(angle) - z * Math.sin(angle), y, x * Math.sin(angle) + z * Math.cos(angle)]);
    const model = new ModelBuilder().roof(ring).walls(ring);
    const { panels } = autoLayout(model, params(), panel);

    expect(panels.length).toBeGreaterThan(30);
    for (const placed of panels) {
      expect(placed.azimuthDegrees).toBeCloseTo(210, 0);
      for (const [x, z] of footprint(placed)) {
        // Back into the building's own frame.
        const u = x * Math.cos(angle) + z * Math.sin(angle);
        const w = -x * Math.sin(angle) + z * Math.cos(angle);
        expect(Math.abs(u)).toBeLessThanOrEqual(10 - DEFAULT_PARAMS.setbackMeters + 0.05);
        expect(Math.abs(w)).toBeLessThanOrEqual(8 - DEFAULT_PARAMS.setbackMeters + 0.05);
      }
    }
  });

  it('keeps clear of a bulkhead standing on the roof', () => {
    const model = new ModelBuilder().box(-10, 10, -10, 10, 10).box(-2, 2, -2, 2, 13);
    const { panels } = autoLayout(model, params(), panel);
    const low = panels.filter((placed) => placed.position[1] < 12);

    expect(low.length).toBeGreaterThan(20);
    for (const placed of low) {
      const inside = footprint(placed).some(([x, z]) => Math.abs(x) < 2 + DEFAULT_PARAMS.setbackMeters - 0.05 && Math.abs(z) < 2 + DEFAULT_PARAMS.setbackMeters - 0.05);
      expect(inside).toBe(false);
    }
  });

  it('skips a podium in the shadow of the tower unless shaded spots are included', () => {
    // Tower to the south (+z) of a low podium, so the podium sits in its shadow.
    const model = new ModelBuilder().box(-10, 10, -10, 10, 60).box(-10, 10, -30, -10, 8);
    const onPodium = (panels: ConceptPanel[]) => panels.filter((placed) => placed.position[1] < 20).length;

    const defaults = autoLayout(model, params(), panel);
    expect(onPodium(defaults.panels)).toBe(0);
    expect(defaults.shadedCount).toBeGreaterThan(0);
    expect(defaults.panels.length).toBeGreaterThan(20);

    expect(onPodium(autoLayout(model, params({ includeShaded: true }), panel).panels)).toBeGreaterThan(20);
  });

  it('lays flush panels along a south slope and skips the north slope', () => {
    const model = new ModelBuilder()
      .roof([[-8, 8, 0], [8, 8, 0], [8, 5, 5], [-8, 5, 5]])
      .roof([[-8, 8, 0], [-8, 5, -5], [8, 5, -5], [8, 8, 0]]);
    const { panels } = autoLayout(model, params({ setbackMeters: 0.3 }), panel);
    const slope = (Math.atan2(3, 5) * 180) / Math.PI;

    expect(panels.length).toBeGreaterThan(5);
    for (const placed of panels) {
      expect(placed.mount).toBe('flush');
      expect(placed.azimuthDegrees).toBeCloseTo(180, 0);
      expect(placed.tiltDegrees).toBeCloseTo(slope, 0);
      expect(placed.position[2]).toBeGreaterThan(0);
    }

    const both = autoLayout(model, params({ setbackMeters: 0.3, includeShaded: true }), panel).panels;
    expect(both.some((placed) => placed.position[2] < 0 && Math.abs(placed.azimuthDegrees - 0) < 1)).toBe(true);
  });

  it('keeps the best-exposed panels when a limit is set', () => {
    const model = new ModelBuilder().box(-10, 10, -10, 10, 60).box(-10, 10, -30, -10, 8);
    const { panels } = autoLayout(model, params({ maxPanels: 12, includeShaded: true }), panel);

    expect(panels).toHaveLength(12);
    expect(panels.every((placed) => placed.position[1] > 50)).toBe(true);
    expect(panels.map((placed) => placed.id)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });

  it('places nothing when the setback leaves no room', () => {
    const model = new ModelBuilder().box(-6, 6, -4, 4, 10);
    expect(autoLayout(model, params({ setbackMeters: 4.5 }), panel).panels).toEqual([]);
  });
});
