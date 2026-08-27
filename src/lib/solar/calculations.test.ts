import { describe, expect, it } from 'vitest';
import { calculateSolarSummary } from './calculations';
import type { SolarPotential } from './types';

const potential: SolarPotential = {
  panelHeightMeters: 1.7,
  panelWidthMeters: 1.1,
  panelCapacityWatts: 400,
  maxArrayPanelsCount: 3,
  carbonOffsetFactorKgPerMwh: 300,
  solarPanels: [
    { center: { latitude: 40.7, longitude: -74 }, orientation: 'PORTRAIT', segmentIndex: 0, yearlyEnergyDcKwh: 500 },
    { center: { latitude: 40.7, longitude: -74 }, orientation: 'PORTRAIT', segmentIndex: 0, yearlyEnergyDcKwh: 450 },
    { center: { latitude: 40.7, longitude: -74 }, orientation: 'PORTRAIT', segmentIndex: 0, yearlyEnergyDcKwh: 400 },
  ],
  roofSegmentStats: [],
  solarPanelConfigs: [],
};

describe('calculateSolarSummary', () => {
  it('uses only selected panels and applies the documented DC-to-AC derate', () => {
    const result = calculateSolarSummary(potential, new Set([0, 2]), 0.3);

    expect(result.panelCount).toBe(2);
    expect(result.capacityKw).toBeCloseTo(0.8);
    expect(result.annualAcKwh).toBeCloseTo((500 + 400) * 0.85);
    expect(result.annualElectricityValueUsd).toBeCloseTo(229.5);
    expect(result.annualCarbonKg).toBeCloseTo(229.5);
    expect(result.refrigeratorYearsEquivalent).toBeCloseTo(765 / 542);
  });

  it('returns zeros when no panels are selected', () => {
    const result = calculateSolarSummary(potential, new Set(), 0.3);

    expect(result.panelCount).toBe(0);
    expect(result.capacityKw).toBe(0);
    expect(result.annualAcKwh).toBe(0);
    expect(result.annualElectricityValueUsd).toBe(0);
    expect(result.annualCarbonKg).toBe(0);
    expect(result.refrigeratorYearsEquivalent).toBe(0);
  });
});
