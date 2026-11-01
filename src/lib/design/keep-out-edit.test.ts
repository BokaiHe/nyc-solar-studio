import { describe, expect, it } from 'vitest';
import type { ConceptPanel } from '@/lib/solar/types';
import { panelInZones, type KeepOutZone } from './keep-out';
import { DEFAULT_PARAMS, initialStudioState, savedPanels, studioReducer, type StudioState } from './state';

const size = { widthMeters: 1, heightMeters: 1.8 };
const zone: KeepOutZone = { id: 1, points: [[-1, 10, -1], [1, 10, -1], [1, 10, 1], [-1, 10, 1]] };
const panel = (id: number, x: number): ConceptPanel => ({ id, position: [x, 10.2, 0], azimuthDegrees: 180, tiltDegrees: 0, landscape: false, mount: 'rack' });
const stateWith = (panels: ConceptPanel[]): StudioState => ({ ...initialStudioState, panels, selectedIds: panels.map(p => p.id), params: { ...DEFAULT_PARAMS, keepOut: [zone] } });

describe('keep-out constraints during editing', () => {
  it('rolls back a whole dragged group when one final panel hits a zone, with no invalid redo or draft', () => {
    const base = stateWith([panel(1, -4), panel(2, -7)]);
    const checkpoint = studioReducer(base, { type: 'checkpoint' });
    const positions: Array<[number, [number, number, number]]> = [[1, [0, 10.2, 0]], [2, [-3, 10.2, 0]]];
    const preview = studioReducer(checkpoint, { type: 'move-panels', positions });
    expect(preview.panels[0].position[0]).toBe(0);
    expect(savedPanels(preview)).toBe(base.panels);
    const rejected = studioReducer(preview, { type: 'move-panels', positions, finish: true, panelSize: size });
    expect(rejected.panels).toBe(base.panels);
    expect(rejected.selectedIds).toEqual([1, 2]);
    expect(rejected.past).toEqual(base.past);
    expect(rejected.future).toEqual([]);
    expect(rejected.moving).toBe(false);
    expect(rejected.notice).toBe('keepOutBlocked');
    expect(studioReducer(rejected, { type: 'redo' }).panels).toBe(base.panels);
  });

  it('accepts a clear drop and keeps undo/redo as one gesture', () => {
    const base = stateWith([panel(1, -4)]);
    const checkpoint = studioReducer(base, { type: 'checkpoint' });
    const preview = studioReducer(checkpoint, { type: 'move-panels', positions: [[1, [0, 10.2, 0]]] });
    const accepted = studioReducer(preview, { type: 'move-panels', positions: [[1, [4, 10.2, 0]]], finish: true, panelSize: size });
    expect(accepted.panels[0].position[0]).toBe(4);
    expect(savedPanels(accepted)).toBe(accepted.panels);
    const undone = studioReducer(accepted, { type: 'undo' });
    expect(undone.panels).toBe(base.panels);
    expect(studioReducer(undone, { type: 'redo' }).panels).toBe(accepted.panels);
    expect(studioReducer(preview, { type: 'cancel-move' }).future).toEqual([]);
  });

  it('rejects rotation and portrait/landscape changes atomically without adding history', () => {
    const base = stateWith([panel(1, 1.53), panel(2, 6)]);
    expect(panelInZones(base.panels[0], size, [zone])).toBe(false);
    for (const change of [{ azimuthDelta: 5 }, { toggleLandscape: true }]) {
      const next = studioReducer(base, { type: 'transform-panels', ids: [1, 2], panelSize: size, ...change });
      expect(next.panels).toBe(base.panels);
      expect(next.past).toEqual([]);
      expect(next.notice).toBe('keepOutBlocked');
    }
    // The actual module dimensions, rather than defaults, decide the fit.
    const small = studioReducer(base, { type: 'transform-panels', ids: [1, 2], toggleLandscape: true, panelSize: { widthMeters: 0.4, heightMeters: 0.6 } });
    expect(small.panels.every(p => p.landscape)).toBe(true);
  });
});

describe('local height of keep-out areas', () => {
  const slope: KeepOutZone = { id: 2, points: [[-10, 5, -3], [10, 15, -3], [10, 15, 3], [-10, 5, 3]] };
  it('detects overlap near both ends of a long pitched roof and ignores a separate roof above it', () => {
    for (const x of [-8, 8]) {
      const onSlope: ConceptPanel = { ...panel(1, x), position: [x, 10 + x / 2 + 0.08, 0], tiltDegrees: Math.atan(0.5) * 180 / Math.PI, azimuthDegrees: 270, mount: 'flush' };
      expect(panelInZones(onSlope, size, [slope])).toBe(true);
      expect(panelInZones({ ...onSlope, position: [x, onSlope.position[1] + 10, 0] }, size, [slope])).toBe(false);
    }
  });

  it('handles thin crossings, contact at an edge and concave outlines', () => {
    const thin: KeepOutZone = { id: 3, points: [[-3, 10, -0.05], [3, 10, -0.05], [3, 10, 0.05], [-3, 10, 0.05]] };
    expect(panelInZones(panel(1, 0), size, [thin])).toBe(true);
    expect(panelInZones(panel(1, 1.5), size, [zone])).toBe(true);
    const l: KeepOutZone = { id: 4, points: [[-4, 10, -4], [4, 10, -4], [4, 10, -2], [-2, 10, -2], [-2, 10, 4], [-4, 10, 4]] };
    expect(panelInZones(panel(1, 0), size, [l])).toBe(false);
    expect(panelInZones(panel(1, -3), size, [l])).toBe(true);
  });
});
