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

function summarize(
  potential: SolarPotential,
  panelCount: number,
  annualDcKwh: number,
  electricityRateUsdPerKwh: number,
): SolarSummary {
  const annualAcKwh = annualDcKwh * DC_TO_AC_DERATE;
  return {
    panelCount,
    capacityKw: (panelCount * potential.panelCapacityWatts) / 1000,
    annualAcKwh,
    annualElectricityValueUsd: annualAcKwh * electricityRateUsdPerKwh,
    annualCarbonKg:
      (annualAcKwh / 1000) * potential.carbonOffsetFactorKgPerMwh,
    refrigeratorYearsEquivalent: annualAcKwh / REFRIGERATOR_KWH_PER_YEAR,
  };
}

export function calculateSolarSummary(
  potential: SolarPotential,
  selectedIndices: ReadonlySet<number>,
  electricityRateUsdPerKwh: number,
): SolarSummary {
  const annualDcKwh = [...selectedIndices].reduce(
    (sum, index) => sum + (potential.solarPanels[index]?.yearlyEnergyDcKwh ?? 0),
    0,
  );
  return summarize(potential, selectedIndices.size, annualDcKwh, electricityRateUsdPerKwh);
}

// Free-form 3D panels have no Google per-panel yield. Estimate them with the
// per-panel average of the smallest Google configuration that covers the count.
export function averagePanelYieldDcKwh(potential: SolarPotential, panelCount: number): number {
  const configs = potential.solarPanelConfigs;
  const reference = configs.find((config) => config.panelsCount >= panelCount) ?? configs.at(-1);
  if (reference?.panelsCount) return reference.yearlyEnergyDcKwh / reference.panelsCount;
  const panels = potential.solarPanels;
  return panels.length
    ? panels.reduce((sum, panel) => sum + panel.yearlyEnergyDcKwh, 0) / panels.length
    : 0;
}

export function calculateConceptSummary(
  potential: SolarPotential,
  panelCount: number,
  electricityRateUsdPerKwh: number,
): SolarSummary {
  const annualDcKwh = averagePanelYieldDcKwh(potential, panelCount) * panelCount;
  return summarize(potential, panelCount, annualDcKwh, electricityRateUsdPerKwh);
}
