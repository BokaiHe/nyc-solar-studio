import { describe, expect, it } from 'vitest';
import { summarizeDesign } from './calculations';

describe('summarizeDesign', () => {
  it('derives capacity, specific yield, bill value and carbon from annual energy', () => {
    const result = summarizeDesign({ panelCount: 10, panelWatts: 400, annualAcKwh: 5000, efficiency: 0.9, carbonKgPerMwh: 300, electricityRateUsdPerKwh: 0.3 });

    expect(result.capacityKw).toBeCloseTo(4);
    expect(result.specificYield).toBeCloseTo(1250);
    expect(result.annualElectricityValueUsd).toBeCloseTo(1500);
    expect(result.annualCarbonKg).toBeCloseTo(1500);
    expect(result.refrigeratorYearsEquivalent).toBeCloseTo(5000 / 542);
  });

  it('omits carbon without a grid factor and handles an empty design', () => {
    const empty = summarizeDesign({ panelCount: 0, panelWatts: 400, annualAcKwh: 0, efficiency: 0, carbonKgPerMwh: null, electricityRateUsdPerKwh: 0.3 });

    expect(empty.capacityKw).toBe(0);
    expect(empty.specificYield).toBe(0);
    expect(empty.annualCarbonKg).toBeNull();
  });
});
