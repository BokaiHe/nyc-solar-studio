import { REFRIGERATOR_KWH_PER_YEAR } from './config';

export type DesignSummary = {
  panelCount: number;
  capacityKw: number;
  annualAcKwh: number;
  // Annual AC kWh per kW of capacity.
  specificYield: number;
  // Average panel yield relative to an ideal unshaded panel here.
  efficiency: number;
  annualElectricityValueUsd: number;
  // Needs a grid emission factor (from Google Solar data); null without one.
  annualCarbonKg: number | null;
  refrigeratorYearsEquivalent: number;
};

export function summarizeDesign({ panelCount, panelWatts, annualAcKwh, efficiency, carbonKgPerMwh, electricityRateUsdPerKwh }: {
  panelCount: number;
  panelWatts: number;
  annualAcKwh: number;
  efficiency: number;
  carbonKgPerMwh: number | null;
  electricityRateUsdPerKwh: number;
}): DesignSummary {
  const capacityKw = (panelCount * panelWatts) / 1000;
  return {
    panelCount,
    capacityKw,
    annualAcKwh,
    specificYield: capacityKw ? annualAcKwh / capacityKw : 0,
    efficiency,
    annualElectricityValueUsd: annualAcKwh * electricityRateUsdPerKwh,
    annualCarbonKg: carbonKgPerMwh === null ? null : (annualAcKwh / 1000) * carbonKgPerMwh,
    refrigeratorYearsEquivalent: annualAcKwh / REFRIGERATOR_KWH_PER_YEAR,
  };
}
