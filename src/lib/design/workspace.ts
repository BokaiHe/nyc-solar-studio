import type { ConceptPanel, LatLng } from '@/lib/solar/types';
import type { PanelSize } from './geometry';
import { validZones } from './keep-out';
import type { LayoutParams } from './state';

export const DRAFT_KEY = 'nyc-solar-workspace-v1';
export const YIELD_COLORS = ['#b45309', '#e99d34', '#d9ce59', '#69b9a6', '#168b9e'];
// Lower edges of the upper four bands, as a share of an ideal unshaded module.
// Open roofs sit near 92% after row shade and auto layout drops weak spots, so
// the scale spends its colors between 65% and 90% where shaded roofs differ.
export const YIELD_STEPS = [0.65, 0.75, 0.85, 0.9];
export function yieldBand(ratio: number): number {
  const value = Number.isFinite(ratio) ? ratio : 0;
  return YIELD_STEPS.filter((step) => value >= step).length;
}
export type Snapshot = { panels: ConceptPanel[]; params: LayoutParams };
export type Comparisons = { A: Snapshot | null; B: Snapshot | null };
export const emptyComparisons = (): Comparisons => ({ A: null, B: null });
export function snapshot(panels: ConceptPanel[], params: LayoutParams): Snapshot {
  return { panels: panels.map(p => ({ ...p, position: [...p.position] })), params: { ...params } };
}
export type Draft = Snapshot & {
  version: 1; savedAt: string; buildingId: string; label: string; location: LatLng;
  comparisons: Comparisons; panelSize: PanelSize; panelWatts: number; rate: number;
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function validSnapshot(value: unknown): boolean {
  if (!object(value) || !object(value.params) || !Array.isArray(value.panels)) return false;
  const p = value.params;
  if (!['azimuthDegrees','tiltDegrees','setbackMeters','rowSpacingMeters','maxPanels'].every(k => finite(p[k]))
    || typeof p.alignToRoof !== 'boolean' || typeof p.includeShaded !== 'boolean') return false;
  // Drafts saved before keep-out zones existed have none.
  if (p.keepOut === undefined) p.keepOut = [];
  else if (!validZones(p.keepOut)) return false;
  const ids = new Set<number>();
  return value.panels.every(panel => {
    if (!object(panel) || !Number.isInteger(panel.id) || ids.has(panel.id as number)
      || !Array.isArray(panel.position) || panel.position.length !== 3 || !panel.position.every(finite)
      || !finite(panel.azimuthDegrees) || !finite(panel.tiltDegrees) || panel.tiltDegrees < 0 || panel.tiltDegrees > 90
      || typeof panel.landscape !== 'boolean' || !['flush','rack'].includes(String(panel.mount))) return false;
    ids.add(panel.id as number);
    return true;
  });
}
export function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const d: unknown = JSON.parse(raw);
    if (!object(d) || d.version !== 1 || !validSnapshot(d) || typeof d.buildingId !== 'string' || !d.buildingId
      || typeof d.label !== 'string' || typeof d.savedAt !== 'string' || !Number.isFinite(Date.parse(d.savedAt))
      || !object(d.location) || !finite(d.location.latitude) || !finite(d.location.longitude)
      || Math.abs(d.location.latitude) > 90 || Math.abs(d.location.longitude) > 180
      || !object(d.panelSize) || !finite(d.panelSize.widthMeters) || d.panelSize.widthMeters <= 0
      || !finite(d.panelSize.heightMeters) || d.panelSize.heightMeters <= 0
      || !finite(d.panelWatts) || d.panelWatts <= 0 || !finite(d.rate) || d.rate < 0
      || !object(d.comparisons)) return null;
    const slots = d.comparisons;
    if (!['A','B'].every(k => slots[k] === null || validSnapshot(slots[k]))) return null;
    return d as Draft;
  } catch { return null; }
}
