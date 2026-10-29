import type { ConceptPanel, RoofModelData } from '@/lib/solar/types';
import { autoLayout, createLayoutContext, type LayoutContext, type LayoutResult } from './auto-layout';
import type { PanelSize } from './geometry';
import type { LayoutParams } from './state';

// 'max-total': the most annual energy from the roof.
// 'balanced': the most energy while each panel keeps at least 90% of an ideal panel's yield.
export type Objective = 'max-total' | 'balanced';

export type LayoutOption = {
  params: LayoutParams;
  panels: ConceptPanel[];
  result: Omit<LayoutResult, 'panels'>;
  // Annual energy in units of one ideal panel (unshaded, best tilt, due south).
  yieldIndex: number;
  // Average yield per panel relative to that ideal panel.
  efficiency: number;
};

export type OptimizerResult = { current: LayoutOption; options: LayoutOption[] };

export const TILT_OPTIONS = [0, 5, 10, 15, 20, 25, 30];
export const ROW_GAP_OPTIONS = [0.3, 0.6, 0.9, 1.2, 1.6, 2];
export const BALANCED_MIN_EFFICIENCY = 0.9;
const OPTION_COUNT = 3;

type Model = Pick<RoofModelData, 'positions' | 'indices' | 'wallPositions' | 'wallIndices' | 'center'>;

export function evaluate(model: Model, params: LayoutParams, panel: PanelSize, context: LayoutContext): LayoutOption {
  const { panels, ...result } = autoLayout(model, params, panel, context);
  const yieldIndex = result.idealPanelScore ? result.totalScore / result.idealPanelScore : 0;
  return { params, panels, result, yieldIndex, efficiency: panels.length ? yieldIndex / panels.length : 0 };
}

function objectiveScore(option: LayoutOption, objective: Objective): number {
  if (objective === 'max-total') return option.yieldIndex;
  return option.efficiency >= BALANCED_MIN_EFFICIENCY ? option.yieldIndex : -1;
}

// Grid search over rack tilt and row gap with the user's other settings
// (facing, setback, limit, shading) held fixed. Flush panels on pitched
// roofs follow their slope and are unaffected by these two settings.
export function optimizeLayout(
  model: Model,
  base: LayoutParams,
  panel: PanelSize,
  objective: Objective,
  onProgress?: (done: number, total: number) => void,
): OptimizerResult {
  const context = createLayoutContext(model);
  const current = evaluate(model, base, panel, context);
  const tried: LayoutOption[] = [];
  const total = TILT_OPTIONS.length * ROW_GAP_OPTIONS.length;
  for (const tiltDegrees of TILT_OPTIONS) {
    for (const rowSpacingMeters of ROW_GAP_OPTIONS) {
      tried.push(evaluate(model, { ...base, tiltDegrees, rowSpacingMeters }, panel, context));
      onProgress?.(tried.length, total);
    }
  }
  let ranked = tried.filter((option) => option.panels.length && objectiveScore(option, objective) >= 0);
  // No layout reaches the efficiency floor: fall back to the most efficient ones.
  if (!ranked.length) ranked = tried.filter((option) => option.panels.length).sort((a, b) => b.efficiency - a.efficiency);
  else ranked.sort((a, b) => objectiveScore(b, objective) - objectiveScore(a, objective) || a.params.rowSpacingMeters - b.params.rowSpacingMeters);
  // Settings that produce the same layout (e.g. any row gap on a one-row roof)
  // show once, keeping the tightest gap.
  const seen = new Set<string>();
  const options = ranked.filter((option) => {
    const key = `${option.params.tiltDegrees}:${option.panels.length}:${option.yieldIndex.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { current, options: options.slice(0, OPTION_COUNT) };
}
