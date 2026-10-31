// Runs auto layout off the main thread so big or crowded roofs never freeze
// the 3D view. The worker keeps the roof's layout context between requests,
// so live updates reuse its sun and sky visibility.
import { autoLayout, createLayoutContext, type LayoutContext, type LayoutResult } from './auto-layout';
import type { PanelSize } from './geometry';
import type { Visibility } from './shading';
import type { LayoutParams } from './state';
import type { NeighborMesh, RoofModelData } from '../solar/types';

export type LayoutRequest = {
  id: number;
  // Sent when the roof or its surroundings changed since the last request.
  scene?: { model: RoofModelData; neighbors: NeighborMesh | null };
  params: LayoutParams;
  panel: PanelSize;
};
export type LayoutMessage =
  // `visibility` holds the cells first computed for this request, for the
  // main thread's context to reuse in energy estimates.
  | { id: number; type: 'done'; result: LayoutResult; visibility: Array<[string, Visibility]> }
  | { id: number; type: 'error' };

let current: { model: RoofModelData; context: LayoutContext } | null = null;

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { id, scene, params, panel } = event.data;
  try {
    if (scene) current = { model: scene.model, context: createLayoutContext(scene.model, scene.neighbors) };
    if (!current) throw new Error('No roof loaded');
    const result = autoLayout(current.model, params, panel, current.context);
    self.postMessage({ id, type: 'done', result, visibility: current.context.visibility.takeComputed() } satisfies LayoutMessage);
  } catch {
    self.postMessage({ id, type: 'error' } satisfies LayoutMessage);
  }
};
