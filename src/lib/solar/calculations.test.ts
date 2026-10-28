import { describe, expect, it } from 'vitest';
import { averagePanelYieldDcKwh, summarizeDesign } from './calculations';
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

const withConfigs: SolarPotential = {
  ...potential,
  solarPanelConfigs: [
    { panelsCount: 2, yearlyEnergyDcKwh: 950 },
    { panelsCount: 3, yearlyEnergyDcKwh: 1350 },
  ],
};

describe('averagePanelYieldDcKwh', () => {
  it('uses the per-panel average of the smallest covering Google configuration', () => {
    expect(averagePanelYieldDcKwh(withConfigs, 1)).toBeCloseTo(475);
    expect(averagePanelYieldDcKwh(withConfigs, 3)).toBeCloseTo(450);
    expect(averagePanelYieldDcKwh(withConfigs, 10)).toBeCloseTo(450);
  });

  it('falls back to the candidate panel average without configurations', () => {
    expect(averagePanelYieldDcKwh(potential, 5)).toBeCloseTo(450);
  });
});

describe('summarizeDesign', () => {
  it('scales capacity and energy with the panel count and applies the DC-to-AC derate', () => {
    const result = summarizeDesign(4, withConfigs, 400, 0.3);

    expect(result.panelCount).toBe(4);
    expect(result.capacityKw).toBeCloseTo(1.6);
    expect(result.annualAcKwh).toBeCloseTo(450 * 4 * 0.85);
    expect(result.annualElectricityValueUsd).toBeCloseTo(450 * 4 * 0.85 * 0.3);
    expect(result.annualCarbonKg).toBeCloseTo((450 * 4 * 0.85 / 1000) * 300);
  });

  it('reports capacity only when Google Solar context is missing', () => {
    const result = summarizeDesign(10, null, 400, 0.3);

    expect(result.capacityKw).toBeCloseTo(4);
    expect(result.annualAcKwh).toBeNull();
    expect(result.annualCarbonKg).toBeNull();
  });
});
