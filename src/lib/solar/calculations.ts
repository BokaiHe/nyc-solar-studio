import {
  DC_TO_AC_DERATE,
  REFRIGERATOR_KWH_PER_YEAR,
} from './config';
import type { SolarPotential } from './types';

export type SolarSummary = {
  panelCount: number;
  capacityKw: number;
  annualAcKwh: number;
  annualElectricityValueUsd: number;
  annualCarbonKg: number;
  refrigeratorYearsEquivalent: number;
};

export function calculateSolarSummary(
  potential: SolarPotential,
  selectedIndices: ReadonlySet<number>,
  electricityRateUsdPerKwh: number,
): SolarSummary {
  const annualDcKwh = [...selectedIndices].reduce(
    (sum, index) => sum + (potential.solarPanels[index]?.yearlyEnergyDcKwh ?? 0),
    0,
  );
  const annualAcKwh = annualDcKwh * DC_TO_AC_DERATE;

  return {
    panelCount: selectedIndices.size,
    capacityKw: (selectedIndices.size * potential.panelCapacityWatts) / 1000,
    annualAcKwh,
    annualElectricityValueUsd: annualAcKwh * electricityRateUsdPerKwh,
    annualCarbonKg:
      (annualAcKwh / 1000) * potential.carbonOffsetFactorKgPerMwh,
    refrigeratorYearsEquivalent: annualAcKwh / REFRIGERATOR_KWH_PER_YEAR,
  };
}
