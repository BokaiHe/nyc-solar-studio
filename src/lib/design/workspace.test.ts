import { describe, it, expect } from 'vitest';
import { parseDraft, snapshot, yieldBand, type Draft } from './workspace';
import { DEFAULT_PARAMS, initialStudioState, studioReducer } from './state';
import type { ConceptPanel, RoofModelData } from '@/lib/solar/types';

const panel: ConceptPanel = { id: 1, position: [1, 2, 3], azimuthDegrees: 180, tiltDegrees: 10, landscape: false, mount: 'rack' };
const draft: Draft = { version: 1, savedAt: '2026-10-30T12:00:00Z', buildingId: 'b1', label: 'Test',
  location: { latitude: 40.7, longitude: -74 }, ...snapshot([panel], DEFAULT_PARAMS),
  comparisons: { A: snapshot([panel], DEFAULT_PARAMS), B: snapshot([], DEFAULT_PARAMS) },
  panelSize: { widthMeters: 1, heightMeters: 2 }, panelWatts: 400, rate: 0.3 };

describe('local design workspace', () => {
  it('round trips layouts, settings, both slots and module specifications', () => {
    expect(parseDraft(JSON.stringify(draft))).toEqual(draft);
  });
  it('preserves an explicitly empty layout', () => {
    expect(parseDraft(JSON.stringify({ ...draft, panels: [] }))?.panels).toEqual([]);
  });
  it('rejects corrupt or unsupported local drafts', () => {
    for (const value of [null, '{', '{}', JSON.stringify({ ...draft, version: 2 }), JSON.stringify({ ...draft, comparisons: {} }),
      JSON.stringify({ ...draft, panels: [{ ...panel, position: [1, null, 3] }] }), JSON.stringify({ ...draft, panels: [panel, panel] })]) {
      expect(parseDraft(value)).toBeNull();
    }
  });
  it('snapshots do not change when current panels or settings change', () => {
    const current = [{ ...panel, position: [...panel.position] as [number, number, number] }];
    const params = { ...DEFAULT_PARAMS };
    const saved = snapshot(current, params);
    current[0].position[0] = 99; params.tiltDegrees = 30;
    expect(saved.panels[0].position[0]).toBe(1);
    expect(saved.params.tiltDegrees).toBe(10);
  });
  it('uses a fixed yield scale, including zero and over 100%', () => {
    expect([0, 0.64, 0.7, 0.8, 0.87, 0.92, 1.2, NaN].map(yieldBand)).toEqual([0, 0, 1, 2, 3, 4, 4, 0]);
  });
  it('applies a comparison as an undoable manual layout', () => {
    const current = { ...initialStudioState, panels: [panel] };
    const changed = studioReducer(current, { type: 'restore-layout', panels: [], params: { ...DEFAULT_PARAMS, tiltDegrees: 20 } });
    expect(changed.generated).toBeNull();
    expect(changed.past).toHaveLength(1);
    expect(studioReducer(changed, { type: 'undo' }).panels).toEqual([panel]);
    expect(studioReducer(changed, { type: 'redo' }).panels).toEqual([]);
  });
  it('restores an empty draft into design without treating it as a first auto fill', () => {
    const state = studioReducer(initialStudioState, { type: 'select-building', location: draft.location, label: draft.label });
    const restored = studioReducer(state, { type: 'building-loaded', location: draft.location,
      model: { nycBuildingId: 'b1' } as RoofModelData, panels: [], params: draft.params });
    expect(restored.step).toBe('design');
    expect(restored.pristine).toBe(false);
    expect(restored.past).toEqual([]);
  });
});
