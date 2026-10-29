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

// A rack panel is shaded by the closest matching panel in front of it (toward
// the sun) that overlaps it along the row; the gap between them is its pitch.
function rowInFront(panel: ConceptPanel, panels: ConceptPanel[], size: PanelSize): RowShade | undefined {
  if (panel.mount !== 'rack') return undefined;
  const width = panel.landscape ? size.heightMeters : size.widthMeters;
  const length = panel.landscape ? size.widthMeters : size.heightMeters;
  const { forward, across } = panelAxes(panel.azimuthDegrees);
  let pitch = Infinity;
  for (const other of panels) {
    if (other === panel || !sameOrientation(panel, other) || Math.abs(other.position[1] - panel.position[1]) > 1) continue;
    const dx = other.position[0] - panel.position[0];
    const dz = other.position[2] - panel.position[2];
    const ahead = dx * forward[0] + dz * forward[1];
    const aside = Math.abs(dx * across[0] + dz * across[1]);
    if (ahead > length * 0.3 && aside < width * 0.9 && ahead < pitch) pitch = ahead;
  }
  return Number.isFinite(pitch) ? { lengthMeters: length, pitchMeters: pitch } : undefined;
}

// Annual yield of an arbitrary design, including hand-placed and moved panels,
// with the same model the auto layout scores with.
export function estimateDesignEnergy(panels: ConceptPanel[], context: LayoutContext, size: PanelSize): DesignEnergy {
  const yields = panels.map((panel) => annualYield(
    panelNormal(panel.azimuthDegrees, panel.tiltDegrees),
    panel.azimuthDegrees,
    panel.tiltDegrees,
    context.visibility.at(panel.position),
    context.samples,
    rowInFront(panel, panels, size),
  ));
  const totalYield = yields.reduce((sum, value) => sum + value, 0);
  return {
    yields,
    totalYield,
    efficiency: panels.length && context.idealPanelScore ? totalYield / panels.length / context.idealPanelScore : 0,
  };
}
