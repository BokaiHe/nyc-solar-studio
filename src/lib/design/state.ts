import type { BuildingInsights, ConceptPanel, LatLng, RoofModelData } from '@/lib/solar/types';

export type Step = 'select' | 'design' | 'results';
export type BuildingStatus = 'idle' | 'loading' | 'ready' | 'no-model' | 'error';
export type NoticeKey = 'sharedModelChanged';

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
};

export type StudioState = {
  step: Step;
  building: Building;
  panels: ConceptPanel[];
  past: ConceptPanel[][];
  future: ConceptPanel[][];
  selectedId: number | null;
  params: LayoutParams;
  notice: NoticeKey | null;
};

export type StudioAction =
  | { type: 'select-building'; location: LatLng; label: string }
  | { type: 'building-loaded'; location: LatLng; model: RoofModelData; insights: BuildingInsights | null; panels?: ConceptPanel[]; notice?: NoticeKey | null }
  | { type: 'building-failed'; status: 'no-model' | 'error' }
  | { type: 'set-step'; step: Step }
  | { type: 'set-params'; params: Partial<LayoutParams> }
  | { type: 'set-panels'; panels: ConceptPanel[] }
  | { type: 'add-panel'; panel: Omit<ConceptPanel, 'id'>; minSpacing: number }
  | { type: 'update-panel'; id: number; patch: Partial<Omit<ConceptPanel, 'id'>> }
  | { type: 'remove-panel'; id: number }
  | { type: 'drag-start'; id: number }
  | { type: 'drag-move'; id: number; position: [number, number, number] }
  | { type: 'select-panel'; id: number | null }
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
  building: { status: 'idle', location: null, label: '', model: null, insights: null },
  panels: [],
  past: [],
  future: [],
  selectedId: null,
  params: DEFAULT_PARAMS,
  notice: null,
};

export function nextPanelId(panels: ConceptPanel[]): number {
  return panels.reduce((max, panel) => Math.max(max, panel.id), 0) + 1;
}

// Every edit that the user can undo goes through here.
function commit(state: StudioState, panels: ConceptPanel[], selectedId = state.selectedId): StudioState {
  if (panels === state.panels) return state;
  return {
    ...state,
    panels,
    past: [...state.past, state.panels].slice(-HISTORY_LIMIT),
    future: [],
    selectedId: selectedId !== null && panels.some((panel) => panel.id === selectedId) ? selectedId : null,
  };
}

export function canDesign(state: StudioState): boolean {
  return state.building.status === 'ready' && state.building.model !== null;
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'select-building':
      return {
        ...initialStudioState,
        params: state.params,
        building: { status: 'loading', location: action.location, label: action.label, model: null, insights: null },
      };
    case 'building-loaded':
      if (state.building.status !== 'loading') return state;
      return {
        ...state,
        building: { ...state.building, status: 'ready', location: action.location, model: action.model, insights: action.insights },
        panels: action.panels ?? [],
        past: [],
        future: [],
        notice: action.notice ?? null,
        step: action.panels?.length ? 'design' : state.step,
      };
    case 'building-failed':
      if (state.building.status !== 'loading') return state;
      return { ...state, building: { ...state.building, status: action.status } };
    case 'set-step':
      if (action.step !== 'select' && !canDesign(state)) return state;
      return { ...state, step: action.step, selectedId: action.step === 'design' ? state.selectedId : null };
    case 'set-params':
      return { ...state, params: { ...state.params, ...action.params } };
    case 'set-panels':
      return commit(state, action.panels, null);
    case 'add-panel': {
      const [x, y, z] = action.panel.position;
      // Panels on another roof level directly above or below do not collide.
      if (state.panels.some((panel) => Math.hypot(panel.position[0] - x, panel.position[2] - z) < action.minSpacing
        && Math.abs(panel.position[1] - y) < 1)) return state;
      const id = nextPanelId(state.panels);
      return commit(state, [...state.panels, { ...action.panel, id }], id);
    }
    case 'update-panel':
      return commit(state, state.panels.map((panel) => panel.id === action.id ? { ...panel, ...action.patch } : panel));
    case 'remove-panel':
      return commit(state, state.panels.filter((panel) => panel.id !== action.id));
    case 'drag-start':
      // Snapshot once so a whole drag undoes in one step; moves below skip history.
      return { ...state, past: [...state.past, state.panels].slice(-HISTORY_LIMIT), future: [], selectedId: action.id };
    case 'drag-move':
      return { ...state, panels: state.panels.map((panel) => panel.id === action.id ? { ...panel, position: action.position } : panel) };
    case 'select-panel':
      return { ...state, selectedId: action.id };
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { ...state, panels: previous, past: state.past.slice(0, -1), future: [state.panels, ...state.future], selectedId: null };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, panels: next, past: [...state.past, state.panels], future: state.future.slice(1), selectedId: null };
    }
    case 'reset':
      return { ...initialStudioState, params: state.params };
  }
}
