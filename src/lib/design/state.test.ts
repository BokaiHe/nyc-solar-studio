import { describe, expect, it } from 'vitest';
import type { RoofModelData } from '@/lib/solar/types';
import { initialStudioState, studioReducer, type StudioAction, type StudioState } from './state';

const addAt = (position: [number, number, number], azimuthDegrees = 180): StudioAction => ({
  type: 'add-panel',
  panel: { position, azimuthDegrees, tiltDegrees: 10, landscape: false, mount: 'rack' },
  minSpacing: 0.7,
});

const model = { nycBuildingId: 'b1' } as RoofModelData;
const location = { latitude: 40.7, longitude: -74 };

function run(actions: StudioAction[], state: StudioState = initialStudioState): StudioState {
  return actions.reduce(studioReducer, state);
}

const loaded: StudioAction[] = [
  { type: 'select-building', location, label: 'Test' },
  { type: 'building-loaded', location, model, insights: null },
];

describe('studioReducer', () => {
  it('only allows the design and results steps once a model is loaded', () => {
    const loading = run([{ type: 'select-building', location, label: 'Test' }, { type: 'set-step', step: 'design' }]);
    expect(loading.step).toBe('select');

    const ready = run([...loaded, { type: 'set-step', step: 'results' }]);
    expect(ready.step).toBe('results');
  });

  it('ignores a late model response after the building failed or changed', () => {
    const failed = run([
      { type: 'select-building', location, label: 'Test' },
      { type: 'building-failed', status: 'no-model' },
      { type: 'building-loaded', location, model, insights: null },
    ]);
    expect(failed.building.status).toBe('no-model');
  });

  it('opens a shared layout straight in the design step', () => {
    const shared = run([
      { type: 'select-building', location, label: 'Shared' },
      { type: 'building-loaded', location, model, insights: null, panels: [{ id: 1, position: [0, 0, 0], azimuthDegrees: 180, tiltDegrees: 10, landscape: false, mount: 'rack' }] },
    ]);
    expect(shared.step).toBe('design');
    expect(shared.past).toEqual([]);
  });

  it('adds panels, selects the new one and rejects overlapping clicks on the same level', () => {
    const state = run([
      ...loaded,
      addAt([0, 5, 0], 200),
      addAt([0.3, 5, 0]),
      addAt([0.3, 12, 0]),
      addAt([2, 5, 0]),
    ]);
    expect(state.panels.map((panel) => panel.id)).toEqual([1, 2, 3]);
    expect(state.panels[0]).toMatchObject({ azimuthDegrees: 200, mount: 'rack' });
    expect(state.selectedId).toBe(3);
  });

  it('undoes a whole drag in one step and supports redo', () => {
    const placed = run([...loaded, addAt([0, 5, 0])]);
    const dragged = run([
      { type: 'drag-start', id: 1 },
      { type: 'drag-move', id: 1, position: [1, 5, 0] },
      { type: 'drag-move', id: 1, position: [2, 5, 0] },
    ], placed);
    expect(dragged.panels[0].position).toEqual([2, 5, 0]);

    const undone = studioReducer(dragged, { type: 'undo' });
    expect(undone.panels[0].position).toEqual([0, 5, 0]);
    expect(studioReducer(undone, { type: 'redo' }).panels[0].position).toEqual([2, 5, 0]);
  });

  it('clears selection when the selected panel is removed and new edits drop redo', () => {
    const state = run([
      ...loaded,
      addAt([0, 5, 0]),
      { type: 'remove-panel', id: 1 },
    ]);
    expect(state.selectedId).toBeNull();

    const branched = run([{ type: 'undo' }, addAt([3, 5, 0])], state);
    expect(branched.future).toEqual([]);
  });

  it('keeps layout parameters when switching buildings', () => {
    const state = run([
      { type: 'set-params', params: { tiltDegrees: 20 } },
      { type: 'select-building', location, label: 'Next' },
    ]);
    expect(state.params.tiltDegrees).toBe(20);
  });
});
