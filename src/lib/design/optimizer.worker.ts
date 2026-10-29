// Runs the layout optimizer off the main thread; dozens of full layouts on a
// large roof would otherwise freeze the 3D view.
import { optimizeLayout, type Objective, type OptimizerResult } from './optimizer';
import type { PanelSize } from './geometry';
import type { LayoutParams } from './state';
import type { RoofModelData } from '../solar/types';

export type OptimizerRequest = { model: RoofModelData; params: LayoutParams; panel: PanelSize; objective: Objective };
export type OptimizerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: OptimizerResult }
  | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<OptimizerRequest>) => {
  const { model, params, panel, objective } = event.data;
  try {
    const result = optimizeLayout(model, params, panel, objective, (done, total) => {
      self.postMessage({ type: 'progress', done, total } satisfies OptimizerMessage);
    });
    self.postMessage({ type: 'done', result } satisfies OptimizerMessage);
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Optimizer failed' } satisfies OptimizerMessage);
  }
};
