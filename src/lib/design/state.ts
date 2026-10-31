import type { BuildingInsights, ConceptPanel, LatLng, NeighborMesh, RoofModelData } from '@/lib/solar/types';

export type Step = 'select' | 'design' | 'results';
export type BuildingStatus = 'idle' | 'loading' | 'ready' | 'no-model' | 'outside' | 'error';
export type NoticeKey = 'sharedModelChanged';
export type Tool = 'select' | 'add' | 'erase';
export type SelectMode = 'replace' | 'add' | 'toggle';
type Position = [number, number, number];

export type LayoutParams = {
  // Requested facing for racks on flat roofs; pitched roofs use their own slope.
  azimuthDegrees: number;
  tiltDegrees: number;
  setbackMeters: number;
  rowSpacingMeters: number;
  // Snap rack rows to the building's edges, using the axis nearest the azimuth.
  alignToRoof: boolean;
  // Keep positions in the building's own shadow or on poorly facing slopes.
  includeShaded: boolean;
  // 0 fills every good position; otherwise keep the best-exposed N.
  maxPanels: number;
};

export type Building = {
  status: BuildingStatus;
  location: LatLng | null;
  label: string;
  model: RoofModelData | null;
  // Google Solar data is optional context (panel size, grid factor); design never waits on it.
  insights: BuildingInsights | null;
  // Surrounding buildings that can shade the roof, loaded after the model.
  neighbors: NeighborMesh | null;
  neighborStatus: 'idle' | 'loading' | 'ready' | 'error';
};

export type StudioState = {
  step: Step;
  building: Building;
  panels: ConceptPanel[];
  past: ConceptPanel[][];
  future: ConceptPanel[][];
  selectedIds: number[];
  tool: Tool;
  params: LayoutParams;
  // The last generated layout, the settings and the shading data (see
  // shadingKey) that produced it. While `panels` is still this exact array,
  // the layout is untouched by hand.
  generated: { panels: ConceptPanel[]; params: LayoutParams; shading: string } | null;
  // True from loading a building without a saved layout until the first
  // array is generated. A layout from a link or draft — even an empty one —
  // is kept as it is.
  autoFill: boolean;
  notice: NoticeKey | null;
};

export type StudioAction =
  | { type: 'select-building'; location: LatLng; label: string }
  | { type: 'building-loaded'; location: LatLng; model: RoofModelData; insights: BuildingInsights | null; panels?: ConceptPanel[]; params?: LayoutParams; notice?: NoticeKey | null }
  | { type: 'restore-layout'; panels: ConceptPanel[]; params: LayoutParams }
  | { type: 'building-failed'; status: 'no-model' | 'outside' | 'error' }
  | { type: 'neighbors-loaded'; buildingId: string; neighbors: NeighborMesh }
  | { type: 'neighbors-failed'; buildingId: string }
  | { type: 'set-step'; step: Step }
  | { type: 'set-tool'; tool: Tool }
  | { type: 'set-params'; params: Partial<LayoutParams> }
  // `record: false` replaces an untouched generated layout without a new undo step.
  | { type: 'generated'; panels: ConceptPanel[]; params: LayoutParams; shading: string; record: boolean }
  | { type: 'clear-panels' }
  | { type: 'add-panel'; panel: Omit<ConceptPanel, 'id'>; minSpacing: number }
  | { type: 'transform-panels'; ids: number[]; azimuthDelta?: number; toggleLandscape?: boolean }
  | { type: 'remove-panels'; ids: number[]; record?: boolean }
  // Snapshot before a drag or erase stroke so the whole gesture undoes at once.
  | { type: 'checkpoint' }
  | { type: 'move-panels'; positions: Array<[number, Position]> }
  | { type: 'select'; ids: number[]; mode: SelectMode }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' };

export const DEFAULT_PARAMS: LayoutParams = {
  azimuthDegrees: 180,
  tiltDegrees: 10,
  setbackMeters: 1.2,
  rowSpacingMeters: 0.8,
  alignToRoof: true,
  includeShaded: false,
  maxPanels: 0,
};

const HISTORY_LIMIT = 50;

export const initialStudioState: StudioState = {
  step: 'select',
  building: { status: 'idle', location: null, label: '', model: null, insights: null, neighbors: null, neighborStatus: 'idle' },
  panels: [],
  past: [],
  future: [],
  selectedIds: [],
  tool: 'select',
  params: DEFAULT_PARAMS,
  generated: null,
  autoFill: false,
  notice: null,
};

export function nextPanelId(panels: ConceptPanel[]): number {
  return panels.reduce((max, panel) => Math.max(max, panel.id), 0) + 1;
}

function keepExisting(ids: number[], panels: ConceptPanel[]): number[] {
  const present = new Set(panels.map((panel) => panel.id));
  return ids.filter((id) => present.has(id));
}

// Every edit that the user can undo goes through here.
function commit(state: StudioState, panels: ConceptPanel[], selectedIds = state.selectedIds): StudioState {
  if (panels === state.panels) return state;
  return {
    ...state,
    panels,
    past: [...state.past, state.panels].slice(-HISTORY_LIMIT),
    future: [],
    selectedIds: keepExisting(selectedIds, panels),
  };
}

export function canDesign(state: StudioState): boolean {
  return state.building.status === 'ready' && state.building.model !== null;
}

// True while the panels are exactly the last generated layout.
export function isUntouchedLayout(state: StudioState): boolean {
  return state.generated !== null && state.panels === state.generated.panels;
}

// Identifies the shading data a layout was scored with, so a layout made
// before the surrounding buildings arrived can be refreshed once they do.
export function shadingKey(building: Building): string {
  return building.neighborStatus === 'ready' && building.neighbors ? `neighbors:${building.neighbors.buildingCount}` : 'self';
}

export function sameParams(a: LayoutParams, b: LayoutParams): boolean {
  return (Object.keys(a) as Array<keyof LayoutParams>).every((key) => a[key] === b[key]);
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'select-building':
      return {
        ...initialStudioState,
        params: state.params,
        tool: state.tool,
        building: { status: 'loading', location: action.location, label: action.label, model: null, insights: null, neighbors: null, neighborStatus: 'idle' },
      };
    case 'building-loaded':
      if (state.building.status !== 'loading') return state;
      return {
        ...state,
        building: { ...state.building, status: 'ready', location: action.location, model: action.model, insights: action.insights, neighborStatus: action.model.nycBuildingId ? 'loading' : 'error' },
        panels: action.panels ?? [],
        past: [],
        future: [],
        notice: action.notice ?? null,
        params: action.params ?? state.params,
        autoFill: action.panels === undefined,
        step: action.panels !== undefined ? 'design' : state.step,
      };
    case 'restore-layout':
      return { ...commit(state, action.panels, []), params: action.params, generated: null, autoFill: false };
    case 'building-failed':
      if (state.building.status !== 'loading') return state;
      return { ...state, building: { ...state.building, status: action.status } };
    case 'neighbors-loaded':
    case 'neighbors-failed':
      // A late answer for a building the user already left is ignored.
      if (state.building.model?.nycBuildingId !== action.buildingId) return state;
      return {
        ...state,
        building: action.type === 'neighbors-loaded'
          ? { ...state.building, neighbors: action.neighbors, neighborStatus: 'ready' }
          : { ...state.building, neighbors: null, neighborStatus: 'error' },
      };
    case 'set-step':
      if (action.step !== 'select' && !canDesign(state)) return state;
      return { ...state, step: action.step, selectedIds: action.step === 'design' ? state.selectedIds : [] };
    case 'set-tool':
      return { ...state, tool: action.tool, selectedIds: action.tool === 'select' ? state.selectedIds : [] };
    case 'set-params':
      return { ...state, params: { ...state.params, ...action.params } };
    case 'generated': {
      const generated = { panels: action.panels, params: action.params, shading: action.shading };
      if (!action.record) return { ...state, panels: action.panels, selectedIds: [], generated, autoFill: false };
      return { ...commit(state, action.panels, []), generated, autoFill: false };
    }
    case 'clear-panels':
      return state.panels.length ? commit(state, [], []) : state;
    case 'add-panel': {
      const [x, y, z] = action.panel.position;
      // Panels on another roof level directly above or below do not collide.
      if (state.panels.some((panel) => Math.hypot(panel.position[0] - x, panel.position[2] - z) < action.minSpacing
        && Math.abs(panel.position[1] - y) < 1)) return state;
      const id = nextPanelId(state.panels);
      return commit(state, [...state.panels, { ...action.panel, id }], [id]);
    }
    case 'transform-panels': {
      const ids = new Set(action.ids);
      if (!ids.size) return state;
      return commit(state, state.panels.map((panel) => ids.has(panel.id)
        ? {
          ...panel,
          azimuthDegrees: (((panel.azimuthDegrees + (action.azimuthDelta ?? 0)) % 360) + 360) % 360,
          landscape: action.toggleLandscape ? !panel.landscape : panel.landscape,
        }
        : panel));
    }
    case 'remove-panels': {
      const ids = new Set(action.ids);
      const panels = state.panels.filter((panel) => !ids.has(panel.id));
      if (panels.length === state.panels.length) return state;
      if (action.record === false) return { ...state, panels, selectedIds: keepExisting(state.selectedIds, panels) };
      return commit(state, panels);
    }
    case 'checkpoint':
      return { ...state, past: [...state.past, state.panels].slice(-HISTORY_LIMIT), future: [] };
    case 'move-panels': {
      const moves = new Map(action.positions);
      return { ...state, panels: state.panels.map((panel) => moves.has(panel.id) ? { ...panel, position: moves.get(panel.id)! } : panel) };
    }
    case 'select': {
      const current = new Set(action.mode === 'replace' ? [] : state.selectedIds);
      for (const id of action.ids) {
        if (action.mode === 'toggle' && current.has(id)) current.delete(id);
        else current.add(id);
      }
      return { ...state, selectedIds: keepExisting([...current], state.panels) };
    }
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { ...state, panels: previous, past: state.past.slice(0, -1), future: [state.panels, ...state.future], selectedIds: [] };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, panels: next, past: [...state.past, state.panels], future: state.future.slice(1), selectedIds: [] };
    }
    case 'reset':
      return { ...initialStudioState, params: state.params };
  }
}
