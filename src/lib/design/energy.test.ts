import { describe, expect, it } from 'vitest';
import type { ConceptPanel } from '@/lib/solar/types';
import { autoLayout, createLayoutContext } from './auto-layout';
import { estimateDesignEnergy } from './energy';
import { annualSunSamples, annualYield, idealPanelYield, panelNormal } from './shading';
import { DEFAULT_PARAMS } from './state';

const samples = annualSunSamples({ latitude: 40.71, longitude: -74 });
const open = { sun: new Uint8Array(samples.length).fill(1), sky: 1 };
const yieldAt = (azimuth: number, tilt: number, visibility = open) => annualYield(panelNormal(azimuth, tilt), azimuth, tilt, visibility, samples);

describe('annual yield model', () => {
  it('gives New York-like yields that favor south-facing, latitude-ish tilts', () => {
    const ideal = idealPanelYield(samples);
    // PVWatts puts NYC near 1,250–1,300 kWh/kWp; ERA5 weather reads a little sunnier.
    expect(ideal).toBeGreaterThan(1200);
    expect(ideal).toBeLessThan(1450);
    expect(yieldAt(180, 35)).toBeGreaterThan(yieldAt(180, 10));
    expect(yieldAt(180, 10)).toBeGreaterThan(yieldAt(180, 0));
    expect(yieldAt(180, 30)).toBeGreaterThan(yieldAt(90, 30));
    expect(yieldAt(90, 30)).toBeGreaterThan(yieldAt(0, 30));
  });

  it('loses energy when the sky or the sun is blocked', () => {
    const halfSky = { ...open, sky: 0.5 };
    const noSun = { sun: new Uint8Array(samples.length), sky: 1 };
    expect(yieldAt(180, 10, halfSky)).toBeLessThan(yieldAt(180, 10));
    // Diffuse light alone still produces a meaningful share.
    expect(yieldAt(180, 10, noSun)).toBeGreaterThan(0.25 * yieldAt(180, 10));
    expect(yieldAt(180, 10, noSun)).toBeLessThan(0.7 * yieldAt(180, 10));
  });
});

describe('estimateDesignEnergy', () => {
  const ring = [[-15, 10, -10], [15, 10, -10], [15, 10, 10], [-15, 10, 10]];
  const roof = { positions: ring.flat(), indices: [0, 1, 2, 0, 2, 3], wallPositions: [], wallIndices: [], center: { latitude: 40.7, longitude: -74 } };
  const size = { widthMeters: 1, heightMeters: 1.8 };
  const context = createLayoutContext(roof);
  const rack = (id: number, z: number): ConceptPanel => ({ id, position: [0, 10.3, z], azimuthDegrees: 180, tiltDegrees: 25, landscape: false, mount: 'rack' });

  it('shades a panel standing close behind another row', () => {
    const lone = estimateDesignEnergy([rack(1, 0)], context, size);
    // Panel 2 sits 2 m north (−z) of panel 1, which is in front of it toward the sun.
    const pair = estimateDesignEnergy([rack(1, 0), rack(2, -2)], context, size);
    expect(pair.yields[0]).toBeCloseTo(lone.yields[0]);
    expect(pair.yields[1]).toBeLessThan(pair.yields[0] * 0.97);
  });

  it('agrees with the auto layout for a generated array', () => {
    const generated = autoLayout(roof, DEFAULT_PARAMS, size, context);
    const estimated = estimateDesignEnergy(generated.panels, context, size);
    expect(estimated.totalYield).toBeCloseTo(generated.totalScore, -1);
    expect(Math.abs(estimated.totalYield / generated.totalScore - 1)).toBeLessThan(0.01);
    expect(estimated.efficiency).toBeGreaterThan(0.8);
    expect(estimated.efficiency).toBeLessThanOrEqual(1);
  });
});
