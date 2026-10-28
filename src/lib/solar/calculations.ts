import {
  DC_TO_AC_DERATE,
  REFRIGERATOR_KWH_PER_YEAR,
} from './config';
import type { SolarPotential } from './types';

export type DesignSummary = {
  panelCount: number;
  capacityKw: number;
  // Energy figures need Google Solar context; they are null when it is unavailable.
  annualAcKwh: number | null;
  annualElectricityValueUsd: number | null;
  annualCarbonKg: number | null;
  refrigeratorYearsEquivalent: number | null;
};

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

export function summarizeDesign(
  panelCount: number,
  potential: SolarPotential | null,
  panelWatts: number,
  electricityRateUsdPerKwh: number,
): DesignSummary {
  const capacityKw = (panelCount * panelWatts) / 1000;
  if (!potential) {
    return {
      panelCount,
      capacityKw,
      annualAcKwh: null,
      annualElectricityValueUsd: null,
      annualCarbonKg: null,
      refrigeratorYearsEquivalent: null,
    };
  }
  const annualAcKwh = averagePanelYieldDcKwh(potential, panelCount) * panelCount * DC_TO_AC_DERATE;
  return {
    panelCount,
    capacityKw,
    annualAcKwh,
    annualElectricityValueUsd: annualAcKwh * electricityRateUsdPerKwh,
    annualCarbonKg: (annualAcKwh / 1000) * potential.carbonOffsetFactorKgPerMwh,
    refrigeratorYearsEquivalent: annualAcKwh / REFRIGERATOR_KWH_PER_YEAR,
  };
}
