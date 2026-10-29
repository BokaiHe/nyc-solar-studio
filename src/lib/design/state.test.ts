import { describe, expect, it } from 'vitest';
import type { ConceptPanel, RoofModelData } from '@/lib/solar/types';
import { DEFAULT_PARAMS, initialStudioState, isUntouchedLayout, studioReducer, type StudioAction, type StudioState } from './state';

const addAt = (position: [number, number, number], azimuthDegrees = 180): StudioAction => ({
  type: 'add-panel',
  panel: { position, azimuthDegrees, tiltDegrees: 10, landscape: false, mount: 'rack' },
  minSpacing: 0.7,
});

const panel = (id: number, x: number): ConceptPanel => ({ id, position: [x, 5, 0], azimuthDegrees: 180, tiltDegrees: 10, landscape: false, mount: 'rack' });

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
      { type: 'building-loaded', location, model, insights: null, panels: [panel(1, 0)] },
    ]);
    expect(shared.step).toBe('design');
    expect(shared.past).toEqual([]);
  });

  it('adds panels, selects the new one and rejects overlapping clicks on the same level', () => {
    const state = run([...loaded, addAt([0, 5, 0], 200), addAt([0.3, 5, 0]), addAt([0.3, 12, 0]), addAt([2, 5, 0])]);
    expect(state.panels.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(state.panels[0]).toMatchObject({ azimuthDegrees: 200, mount: 'rack' });
    expect(state.selectedIds).toEqual([3]);
  });

  it('supports replace, add and toggle selection', () => {
    const base = run([...loaded, { type: 'generated', panels: [panel(1, 0), panel(2, 2), panel(3, 4)], params: DEFAULT_PARAMS, shading: 'self', record: true }]);
    const added = run([{ type: 'select', ids: [1], mode: 'replace' }, { type: 'select', ids: [3], mode: 'add' }], base);
    expect(added.selectedIds.sort()).toEqual([1, 3]);
    expect(run([{ type: 'select', ids: [1], mode: 'toggle' }], added).selectedIds).toEqual([3]);
    expect(run([{ type: 'select', ids: [9], mode: 'replace' }], added).selectedIds).toEqual([]);
  });

  it('rotates and flips a whole selection in one undo step', () => {
    const base = run([...loaded, { type: 'generated', panels: [panel(1, 0), panel(2, 2)], params: DEFAULT_PARAMS, shading: 'self', record: true }]);
    const turned = run([
      { type: 'transform-panels', ids: [1, 2], azimuthDelta: -5 },
      { type: 'transform-panels', ids: [2], toggleLandscape: true },
    ], base);
    expect(turned.panels.map((item) => item.azimuthDegrees)).toEqual([175, 175]);
    expect(turned.panels[1].landscape).toBe(true);
    expect(studioReducer(turned, { type: 'undo' }).panels[1].landscape).toBe(false);
  });

  it('undoes a whole group move in one step', () => {
    const base = run([...loaded, { type: 'generated', panels: [panel(1, 0), panel(2, 2)], params: DEFAULT_PARAMS, shading: 'self', record: true }]);
    const moved = run([
      { type: 'checkpoint' },
      { type: 'move-panels', positions: [[1, [1, 5, 0]], [2, [3, 5, 0]]] },
      { type: 'move-panels', positions: [[1, [2, 5, 1]], [2, [4, 5, 1]]] },
    ], base);
    expect(moved.panels.map((item) => item.position)).toEqual([[2, 5, 1], [4, 5, 1]]);

    const undone = studioReducer(moved, { type: 'undo' });
    expect(undone.panels.map((item) => item.position[0])).toEqual([0, 2]);
    expect(studioReducer(undone, { type: 'redo' }).panels[0].position).toEqual([2, 5, 1]);
  });

  it('treats an erase stroke as one undo step', () => {
    const base = run([...loaded, { type: 'generated', panels: [panel(1, 0), panel(2, 2), panel(3, 4)], params: DEFAULT_PARAMS, shading: 'self', record: true }]);
    const erased = run([
      { type: 'checkpoint' },
      { type: 'remove-panels', ids: [1], record: false },
      { type: 'remove-panels', ids: [2], record: false },
    ], base);
    expect(erased.panels.map((item) => item.id)).toEqual([3]);
    expect(studioReducer(erased, { type: 'undo' }).panels).toHaveLength(3);
  });

  it('replaces an untouched generated layout live and stops once edited by hand', () => {
    const first = run([...loaded, { type: 'generated', panels: [panel(1, 0)], params: DEFAULT_PARAMS, shading: 'self', record: true }]);
    expect(isUntouchedLayout(first)).toBe(true);

    const live = run([{ type: 'generated', panels: [panel(1, 0), panel(2, 2)], params: { ...DEFAULT_PARAMS, tiltDegrees: 15 }, shading: 'self', record: false }], first);
    expect(live.past).toHaveLength(first.past.length);
    expect(isUntouchedLayout(live)).toBe(true);

    const edited = studioReducer(live, addAt([6, 5, 0]));
    expect(isUntouchedLayout(edited)).toBe(false);
    // Undoing the edit returns to the generated array, which counts as untouched again.
    expect(isUntouchedLayout(studioReducer(edited, { type: 'undo' }))).toBe(true);
  });

  it('clears selection when switching away from the select tool', () => {
    const base = run([...loaded, { type: 'generated', panels: [panel(1, 0)], params: DEFAULT_PARAMS, shading: 'self', record: true }, { type: 'select', ids: [1], mode: 'replace' }]);
    expect(studioReducer(base, { type: 'set-tool', tool: 'erase' }).selectedIds).toEqual([]);
  });

  it('keeps layout parameters when switching buildings', () => {
    const state = run([
      { type: 'set-params', params: { tiltDegrees: 20 } },
      { type: 'select-building', location, label: 'Next' },
    ]);
    expect(state.params.tiltDegrees).toBe(20);
  });

  it('loads neighbors only for the building on screen', () => {
    const neighbors = { positions: [], indices: [], buildingStarts: [], buildingCount: 4, radiusMeters: 200 };
    const ready = run([...loaded, { type: 'neighbors-loaded', buildingId: 'b1', neighbors }]);
    expect(ready.building.neighborStatus).toBe('ready');
    expect(ready.building.neighbors?.buildingCount).toBe(4);

    const stale = run([...loaded, { type: 'neighbors-loaded', buildingId: 'other', neighbors }]);
    expect(stale.building.neighborStatus).toBe('loading');
  });
});
