import type { ConceptPanel } from '@/lib/solar/types';
import type { LayoutContext } from './auto-layout';
import type { PanelSize } from './geometry';
import { panelAxes, sameOrientation } from './panel-ops';
import { annualYield, panelNormal, type RowShade } from './shading';

export type DesignEnergy = {
  // Annual AC yield of each panel, kWh per kW of capacity, in `panels` order.
  yields: number[];
  // Sum of `yields`; multiply by panel kW for the design's annual kWh.
  totalYield: number;
  // Average yield relative to one ideal unshaded panel at this location.
  efficiency: number;
};

// Rows further apart than this do not shade each other in any way worth
// counting: the front row's shadow falls short even at the lowest beam sun.
const MAX_ROW_PITCH_METERS = 8;
const CELL_METERS = 4;
const REACH = Math.ceil(MAX_ROW_PITCH_METERS / CELL_METERS);

// Rack panels bucketed on a horizontal grid, so each panel only looks at
// its neighborhood for the row in front.
function rackGrid(panels: ConceptPanel[]): Map<number, ConceptPanel[]> {
  const grid = new Map<number, ConceptPanel[]>();
  for (const panel of panels) {
    if (panel.mount !== 'rack') continue;
    const key = cellKey(Math.floor(panel.position[0] / CELL_METERS), Math.floor(panel.position[2] / CELL_METERS));
    const bucket = grid.get(key);
    if (bucket) bucket.push(panel);
    else grid.set(key, [panel]);
  }
  return grid;
}

const cellKey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

// A rack panel is shaded by the closest matching panel in front of it (toward
// the sun) that overlaps it along the row; the gap between them is its pitch.
function rowInFront(panel: ConceptPanel, grid: Map<number, ConceptPanel[]>, size: PanelSize): RowShade | undefined {
  if (panel.mount !== 'rack') return undefined;
  const width = panel.landscape ? size.heightMeters : size.widthMeters;
  const length = panel.landscape ? size.widthMeters : size.heightMeters;
  const { forward, across } = panelAxes(panel.azimuthDegrees);
  const ci = Math.floor(panel.position[0] / CELL_METERS);
  const cj = Math.floor(panel.position[2] / CELL_METERS);
  let pitch = Infinity;
  for (let i = ci - REACH; i <= ci + REACH; i += 1) {
    for (let j = cj - REACH; j <= cj + REACH; j += 1) {
      for (const other of grid.get(cellKey(i, j)) ?? []) {
        if (other === panel || !sameOrientation(panel, other) || Math.abs(other.position[1] - panel.position[1]) > 1) continue;
        const dx = other.position[0] - panel.position[0];
        const dz = other.position[2] - panel.position[2];
        const ahead = dx * forward[0] + dz * forward[1];
        const aside = Math.abs(dx * across[0] + dz * across[1]);
        if (ahead > length * 0.3 && ahead <= MAX_ROW_PITCH_METERS && aside < width * 0.9 && ahead < pitch) pitch = ahead;
      }
    }
  }
  return Number.isFinite(pitch) ? { lengthMeters: length, pitchMeters: pitch } : undefined;
}

// Annual yield of an arbitrary design, including hand-placed and moved panels,
// with the same model the auto layout scores with. Panels are immutable, so a
// panel's yield is reused from the context's cache while it and the row in
// front of it are unchanged; an edit only recomputes the panels it touches.
export function estimateDesignEnergy(panels: ConceptPanel[], context: LayoutContext, size: PanelSize): DesignEnergy {
  const grid = rackGrid(panels);
  const yields = panels.map((panel) => {
    const row = rowInFront(panel, grid, size);
    const cached = context.yieldCache.get(panel);
    if (cached && cached.length === row?.lengthMeters && cached.pitch === row?.pitchMeters) return cached.value;
    const value = annualYield(
      panelNormal(panel.azimuthDegrees, panel.tiltDegrees),
      panel.azimuthDegrees,
      panel.tiltDegrees,
      context.visibility.at(panel.position),
      context.samples,
      row,
    );
    context.yieldCache.set(panel, { length: row?.lengthMeters, pitch: row?.pitchMeters, value });
    return value;
  });
  const totalYield = yields.reduce((sum, value) => sum + value, 0);
  return {
    yields,
    totalYield,
    efficiency: panels.length && context.idealPanelScore ? totalYield / panels.length / context.idealPanelScore : 0,
  };
}
