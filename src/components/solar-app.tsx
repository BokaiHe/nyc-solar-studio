'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Map2DCanvas, type MapCanvasHandle, type MapLocation } from './map-2d-canvas';
import { RoofDesigner3D } from './roof-designer-3d';
import { PlaceSearch, type SelectedPlace } from './place-search';
import { calculateConceptSummary, calculateSolarSummary } from '@/lib/solar/calculations';
import { DEFAULT_ELECTRICITY_RATE_USD_PER_KWH, DEMO_BUILDINGS } from '@/lib/solar/config';
import { useI18n, type Dict } from '@/lib/i18n';
import { panelToPolygon } from '@/lib/solar/panel-to-polygon';
import {
  currentNewYorkDateAndMinute,
  formatNewYorkTime,
  getSunSnapshot,
  newYorkDateTimeToDate,
  panelDirectLightFactor,
} from '@/lib/solar/sun';
import {
  encodeSharedDesign,
  parseSharedDesign,
  selectedIndicesFromSharedDesign,
  type SharedConcept,
  type SharedDesign,
} from '@/lib/solar/share-state';
import type {
  BuildingInsights,
  ConceptPanel,
  LatLng,
  PanelOverride,
  RenderPanel,
  RoofModelData,
} from '@/lib/solar/types';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'no-data' | 'error';
type WorkspaceMode = 'explore' | 'focus' | 'design' | 'sun' | 'results';
type MessageKey = keyof Dict['messages'];
type WarningKey = keyof Dict['warnings'];
type ShareKey = keyof Dict['share'];

type State = {
  status: LoadStatus;
  location: MapLocation | null;
  locationLabel: string;
  insights: BuildingInsights | null;
  selected: Set<number>;
  overrides: Map<number, PanelOverride>;
  activePanel: number | null;
  baseCount: number;
  message: MessageKey;
};

type Action =
  | { type: 'loading'; location: MapLocation; label: string }
  | { type: 'loaded'; insights: BuildingInsights; selected?: Set<number>; baseCount?: number }
  | { type: 'no-data' }
  | { type: 'error'; message: MessageKey }
  | { type: 'toggle'; index: number }
  | { type: 'move'; index: number; center: LatLng }
  | { type: 'rotate'; index: number; degrees: number }
  | { type: 'rotate-selected'; degrees: number }
  | { type: 'select-count'; count: number }
  | { type: 'clear' }
  | { type: 'reset' }
  | { type: 'reset-custom' };

const initialState: State = {
  status: 'idle',
  location: null,
  locationLabel: '',
  insights: null,
  selected: new Set(),
  overrides: new Map(),
  activePanel: null,
  baseCount: 0,
  message: 'start',
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loading':
      return { ...initialState, status: 'loading', location: action.location, locationLabel: action.label, message: 'loading' };
    case 'loaded':
      return {
        ...state,
        status: 'ready',
        location: action.insights.center,
        insights: action.insights,
        selected: action.selected ?? new Set(),
        overrides: new Map(),
        activePanel: null,
        baseCount: action.baseCount ?? 0,
        message: 'ready',
      };
    case 'no-data':
      return { ...state, status: 'no-data', insights: null, selected: new Set(), overrides: new Map(), activePanel: null, message: 'noData' };
    case 'error':
      return { ...state, status: 'error', message: action.message };
    case 'toggle': {
      const selected = new Set(state.selected);
      if (selected.has(action.index)) selected.delete(action.index);
      else selected.add(action.index);
      return { ...state, selected, activePanel: action.index };
    }
    case 'move': {
      const overrides = new Map(state.overrides);
      const current = overrides.get(action.index);
      overrides.set(action.index, {
        center: action.center,
        rotationOffsetDegrees: current?.rotationOffsetDegrees ?? 0,
      });
      const selected = new Set(state.selected);
      selected.add(action.index);
      return { ...state, overrides, selected, activePanel: action.index };
    }
    case 'rotate': {
      const insightsPanel = state.insights?.solarPotential.solarPanels[action.index];
      if (!insightsPanel) return state;
      const overrides = new Map(state.overrides);
      const current = overrides.get(action.index);
      overrides.set(action.index, {
        center: current?.center ?? insightsPanel.center,
        rotationOffsetDegrees: ((current?.rotationOffsetDegrees ?? 0) + action.degrees + 360) % 360,
      });
      return { ...state, overrides, activePanel: action.index };
    }
    case 'rotate-selected': {
      if (!state.insights) return state;
      const overrides = new Map(state.overrides);
      state.selected.forEach((index) => {
        const panel = state.insights?.solarPotential.solarPanels[index];
        if (!panel) return;
        const current = overrides.get(index);
        overrides.set(index, {
          center: current?.center ?? panel.center,
          rotationOffsetDegrees: ((current?.rotationOffsetDegrees ?? 0) + action.degrees + 360) % 360,
        });
      });
      return { ...state, overrides, activePanel: null };
    }
    case 'select-count':
      return { ...state, selected: new Set(Array.from({ length: action.count }, (_, index) => index)), overrides: new Map(), activePanel: null, baseCount: action.count };
    case 'clear':
      return { ...state, selected: new Set(), overrides: new Map(), activePanel: null, baseCount: 0 };
    case 'reset':
      return initialState;
    case 'reset-custom':
      return { ...state, overrides: new Map(), activePanel: null };
  }
}

function dateKey(insights: BuildingInsights): string {
  const date = insights.imageryDate;
  return `${date.year}${String(date.month).padStart(2, '0')}${String(date.day).padStart(2, '0')}`;
}

function formatDate(insights: BuildingInsights): string {
  const date = insights.imageryDate;
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function closestSegmentIndex(insights: BuildingInsights, center: LatLng): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  insights.solarPotential.roofSegmentStats.forEach((segment, index) => {
    const north = (segment.center.latitude - center.latitude) * 111_320;
    const east = (segment.center.longitude - center.longitude) * 84_000;
    const distance = north * north + east * east;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function SolarApp() {
  const { t, setLang, lang } = useI18n();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [electricityRate, setElectricityRate] = useState(DEFAULT_ELECTRICITY_RATE_USD_PER_KWH);
  const [shareMessage, setShareMessage] = useState<ShareKey | ''>('');
  const [dataWarning, setDataWarning] = useState<WarningKey | ''>('');
  const [dateIso, setDateIso] = useState('2026-06-21');
  const [minuteOfDay, setMinuteOfDay] = useState(12 * 60);
  const [playing, setPlaying] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('explore');
  const [editMode, setEditMode] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [designSurface, setDesignSurface] = useState<'2d' | '3d'>('2d');
  const [roofModel, setRoofModel] = useState<RoofModelData | null>(null);
  const [roofModelStatus, setRoofModelStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [conceptPanels, setConceptPanels] = useState<ConceptPanel[]>([]);
  const mapRef = useRef<MapCanvasHandle>(null);
  const didLoadSharedRef = useRef(false);
  const didEnterShared3DRef = useRef(false);
  const pendingConceptRef = useRef<SharedConcept | null>(null);
  const searchParams = useSearchParams();
  const sharedDesign = useMemo(() => parseSharedDesign(searchParams.toString()), [searchParams]);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  const simulationDate = useMemo(
    () => newYorkDateTimeToDate(dateIso, minuteOfDay),
    [dateIso, minuteOfDay],
  );
  const sun = useMemo(
    () => state.location
      ? getSunSnapshot(simulationDate, state.location.latitude, state.location.longitude)
      : null,
    [simulationDate, state.location],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const current = currentNewYorkDateAndMinute();
      setDateIso(current.dateIso);
      setMinuteOfDay(current.minuteOfDay);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setMinuteOfDay((current) => {
        if (current >= 1_435) {
          setPlaying(false);
          return 1_439;
        }
        return current + 5;
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [playing]);

  const panels = useMemo<RenderPanel[]>(() => {
    const insights = state.insights;
    if (!insights) return [];
    return insights.solarPotential.solarPanels.map((panel, index) => {
      const override = state.overrides.get(index);
      const center = override?.center ?? panel.center;
      const segmentIndex = override ? closestSegmentIndex(insights, center) : panel.segmentIndex;
      const segment = insights.solarPotential.roofSegmentStats[segmentIndex];
      return panelToPolygon(
        { ...panel, center, segmentIndex },
        segment,
        {
          widthM: insights.solarPotential.panelWidthMeters,
          heightM: insights.solarPotential.panelHeightMeters,
        },
        'ABSOLUTE',
        index,
        0.12,
        override?.rotationOffsetDegrees ?? 0,
      );
    });
  }, [state.insights, state.overrides]);

  const panelLightFactors = useMemo(() => {
    const factors = new Map<number, number>();
    if (!sun) return factors;
    for (const panel of panels) {
      factors.set(
        panel.index,
        panelDirectLightFactor(panel.roofAzimuthDegrees, panel.roofPitchDegrees, sun),
      );
    }
    return factors;
  }, [panels, sun]);

  const analyzeLocation = useCallback(async (place: SelectedPlace, shared?: SharedDesign) => {
    const location = { latitude: place.latitude, longitude: place.longitude };
    dispatch({ type: 'loading', location, label: place.label });
    setRoofModel(null);
    setRoofModelStatus('idle');
    setConceptPanels([]);
    pendingConceptRef.current = shared?.concept ?? null;
    setDesignSurface('2d');
    setDataWarning('');
    setShareMessage('');
    try {
      const response = await fetch(`/api/solar?lat=${place.latitude}&lng=${place.longitude}`);
      if (response.status === 404) {
        dispatch({ type: 'no-data' });
        return;
      }
      if (!response.ok) throw new Error('Solar request failed');
      const insights = (await response.json()) as BuildingInsights;
      if (!insights.solarPotential?.solarPanels?.length) {
        dispatch({ type: 'no-data' });
        return;
      }
      let selected = new Set<number>();
      let baseCount = 0;
      if (shared) {
        selected = selectedIndicesFromSharedDesign(shared);
        baseCount = shared.baseCount;
        const sharedDate = `${shared.imageryDate.year}${String(shared.imageryDate.month).padStart(2, '0')}${String(shared.imageryDate.day).padStart(2, '0')}`;
        if (dateKey(insights) !== sharedDate || insights.solarPotential.solarPanels.length !== shared.panelCount) {
          setDataWarning('roofDataChanged');
        }
      }
      dispatch({ type: 'loaded', insights, selected, baseCount });
      setWorkspaceMode(shared ? 'design' : 'focus');
      setEditMode(false);
      setExamplesOpen(false);
    } catch {
      dispatch({ type: 'error', message: 'solarUnavailable' });
    }
  }, []);

  useEffect(() => {
    if (didLoadSharedRef.current) return;
    if (!sharedDesign) return;
    const timeout = window.setTimeout(() => {
      if (didLoadSharedRef.current) return;
      didLoadSharedRef.current = true;
      void analyzeLocation({
        label: t.places.shared,
        latitude: sharedDesign.latitude,
        longitude: sharedDesign.longitude,
      }, sharedDesign);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [analyzeLocation, sharedDesign, t]);

  const summary = useMemo(
    () => state.insights
      ? calculateSolarSummary(state.insights.solarPotential, state.selected, electricityRate)
      : null,
    [electricityRate, state.insights, state.selected],
  );

  const conceptSummary = useMemo(
    () => state.insights
      ? calculateConceptSummary(state.insights.solarPotential, conceptPanels.length, electricityRate)
      : null,
    [conceptPanels.length, electricityRate, state.insights],
  );

  const presets = useMemo((): Array<{ id: keyof Dict['design2d']['presets']; count: number }> => {
    const configs = state.insights?.solarPotential.solarPanelConfigs ?? [];
    if (!configs.length) return [];
    const indices = [
      Math.floor((configs.length - 1) / 3),
      Math.floor(((configs.length - 1) * 2) / 3),
      configs.length - 1,
    ];
    return [
      { id: 'small' as const, count: configs[indices[0]].panelsCount },
      { id: 'balanced' as const, count: configs[indices[1]].panelsCount },
      { id: 'full' as const, count: configs[indices[2]].panelsCount },
    ].filter((item, index, items) => items.findIndex((candidate) => candidate.count === item.count) === index);
  }, [state.insights]);

  const selectedLightAverage = useMemo(() => {
    if (!state.selected.size) return 0;
    const total = [...state.selected].reduce((sum, index) => sum + (panelLightFactors.get(index) ?? 0), 0);
    return total / state.selected.size;
  }, [panelLightFactors, state.selected]);

  const conceptLightAverage = useMemo(() => {
    if (!sun || !conceptPanels.length) return 0;
    const total = conceptPanels.reduce(
      (sum, panel) => sum + panelDirectLightFactor(panel.azimuthDegrees, panel.tiltDegrees, sun),
      0,
    );
    return total / conceptPanels.length;
  }, [conceptPanels, sun]);

  const is3D = designSurface === '3d';
  const activeSummary = is3D ? conceptSummary : summary;
  const activeLightAverage = is3D ? conceptLightAverage : selectedLightAverage;

  const copyShareLink = useCallback(async () => {
    if (!state.insights || !state.location) return;
    const base = new Set(Array.from({ length: state.baseCount }, (_, index) => index));
    const removed = [...base].filter((index) => !state.selected.has(index));
    const added = [...state.selected].filter((index) => !base.has(index));
    const includeConcept = Boolean(roofModel?.nycBuildingId && (is3D || conceptPanels.length));
    const path = encodeSharedDesign({
      latitude: state.location.latitude,
      longitude: state.location.longitude,
      baseCount: state.baseCount,
      added,
      removed,
      imageryDate: state.insights.imageryDate,
      panelCount: state.insights.solarPotential.solarPanels.length,
      camera: mapRef.current?.getCamera() ?? { heading: 25, tilt: 55, range: 135 },
      ...(includeConcept && roofModel?.nycBuildingId
        ? { concept: { buildingId: roofModel.nycBuildingId, panels: conceptPanels } }
        : {}),
    });
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    if (includeConcept) setShareMessage('copied3d');
    else setShareMessage(state.overrides.size ? 'copiedWithMoves' : 'copied');
  }, [conceptPanels, is3D, roofModel, state]);

  const visiblePanels = useMemo(() => {
    if (workspaceMode === 'explore' || workspaceMode === 'focus') return [];
    if (workspaceMode !== 'design' || !editMode) {
      return panels.filter((panel) => state.selected.has(panel.index));
    }
    const candidateLimit = Math.min(
      panels.length,
      Math.max(48, state.selected.size + 28),
    );
    return panels.filter((panel) => state.selected.has(panel.index) || panel.index < candidateLimit);
  }, [editMode, panels, state.selected, workspaceMode]);

  const mapFocusLocation = useMemo<MapLocation | null>(() => {
    if (!state.location || workspaceMode === 'explore' || workspaceMode === 'focus') {
      return state.location;
    }
    const selectedPanels = panels.filter((panel) => state.selected.has(panel.index));
    if (selectedPanels.length === 0) return state.location;
    return {
      latitude: selectedPanels.reduce((sum, panel) => sum + panel.center.latitude, 0) / selectedPanels.length,
      longitude: selectedPanels.reduce((sum, panel) => sum + panel.center.longitude, 0) / selectedPanels.length,
    };
  }, [panels, state.location, state.selected, workspaceMode]);

  const enterDesign = useCallback(() => {
    if (state.selected.size === 0 && presets.length > 0) {
      dispatch({ type: 'select-count', count: presets[0].count });
    }
    setWorkspaceMode('design');
    setEditMode(false);
  }, [presets, state.selected.size]);

  const resetWorkspace = useCallback(() => {
    dispatch({ type: 'reset' });
    setWorkspaceMode('explore');
    setEditMode(false);
    setPlaying(false);
    setExamplesOpen(false);
    setDataWarning('');
    setShareMessage('');
    setDesignSurface('2d');
    setRoofModel(null);
    setRoofModelStatus('idle');
    setConceptPanels([]);
    pendingConceptRef.current = null;
  }, []);

  const enter3DDesign = useCallback(async () => {
    if (!state.insights) return;
    setWorkspaceMode('design');
    setEditMode(false);
    setDesignSurface('3d');
    if (roofModel) return;
    setRoofModelStatus('loading');
    try {
      const { latitude, longitude } = state.insights.center;
      const response = await fetch(`/api/solar/roof-model?lat=${latitude}&lng=${longitude}`);
      if (!response.ok) throw new Error('Roof model request failed');
      const model = await response.json() as RoofModelData;
      const pending = pendingConceptRef.current;
      pendingConceptRef.current = null;
      if (pending) {
        if (pending.buildingId === model.nycBuildingId) setConceptPanels(pending.panels);
        else setDataWarning('modelChanged');
      }
      setRoofModel(model);
      setRoofModelStatus('idle');
    } catch {
      setRoofModelStatus('error');
    }
  }, [roofModel, state.insights]);

  // Open a shared 3D design once; afterwards the user may switch surfaces freely.
  useEffect(() => {
    if (!sharedDesign?.concept || didEnterShared3DRef.current) return;
    if (state.status !== 'ready' || !state.insights || designSurface === '3d' || roofModelStatus !== 'idle') return;
    const timeout = window.setTimeout(() => {
      didEnterShared3DRef.current = true;
      void enter3DDesign();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [designSurface, enter3DDesign, roofModelStatus, sharedDesign, state.insights, state.status]);

  if (!apiKey) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <section className="max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-8">
          <p className="text-sm font-semibold text-amber-300">{t.apiKey.title}</p>
          <h1 className="mt-2 text-2xl font-semibold">NYC Solar Studio</h1>
          <p className="mt-4 leading-7 text-slate-300">{t.apiKey.before}<code>.env.local</code>{t.apiKey.after}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="relative h-screen min-h-[720px] overflow-hidden bg-slate-950 text-white">
      {designSurface === '3d' && state.status === 'ready' && roofModel ? (
        <RoofDesigner3D
          key={roofModel.nycBuildingId}
          model={roofModel}
          panelWidthMeters={state.insights?.solarPotential.panelWidthMeters ?? 1.1}
          panelHeightMeters={state.insights?.solarPotential.panelHeightMeters ?? 1.8}
          sun={sun}
          panels={conceptPanels}
          onPanelsChange={setConceptPanels}
          showControls={workspaceMode === 'design'}
          notice={dataWarning ? t.warnings[dataWarning] : undefined}
        />
      ) : (
      <Map2DCanvas
        ref={mapRef}
        apiKey={apiKey}
        location={mapFocusLocation}
        buildingBounds={state.insights?.boundingBox}
        panels={visiblePanels}
        selectedIndices={state.selected}
        panelLightFactors={panelLightFactors}
        colorBySun={workspaceMode === 'sun'}
        showBuildingMarker={state.status === 'loading' || workspaceMode === 'focus'}
        allowPanelEditing={workspaceMode === 'design' && editMode}
        allowLocationSelection={workspaceMode === 'explore' || workspaceMode === 'focus'}
        onTogglePanel={(index) => dispatch({ type: 'toggle', index })}
        onMovePanel={(index, center) => dispatch({ type: 'move', index, center })}
        onSelectLocation={(location) => void analyzeLocation({ ...location, label: t.places.mapPick })}
        onMapError={(message) => dispatch({
          type: 'error',
          message: message?.includes('403')
            ? 'mapsForbidden'
            : 'mapsFailed',
        })}
      />
      )}

      {designSurface === '3d' && roofModelStatus === 'loading' && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-slate-950/80 backdrop-blur-sm">
          <div className="rounded-3xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            <p className="mt-4 text-sm font-semibold">{t.model3d.loadingTitle}</p>
            <p className="mt-1 text-xs text-slate-400">{t.model3d.loadingBody}</p>
          </div>
        </div>
      )}

      {designSurface === '3d' && roofModelStatus === 'error' && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-slate-950/80 backdrop-blur-sm">
          <div className="w-[min(420px,calc(100vw-2rem))] rounded-3xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl">
            <p className="font-semibold text-amber-300">{t.model3d.errorTitle}</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">{t.model3d.errorBody}</p>
            <button type="button" onClick={() => { setDesignSurface('2d'); setRoofModelStatus('idle'); }} className="mt-5 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-950">{t.model3d.back2d}</button>
          </div>
        </div>
      )}

      <header className="absolute left-4 right-4 top-4 z-30 flex items-start gap-2 lg:left-5 lg:right-auto">
        <button type="button" onClick={resetWorkspace} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-slate-950/90 text-sm font-black tracking-tight shadow-xl backdrop-blur-xl" aria-label={t.header.home}>
          SR
        </button>
        <div className="w-[min(390px,calc(100vw-5.5rem))] rounded-2xl border border-white/10 bg-slate-950/90 p-1.5 shadow-xl backdrop-blur-xl">
          <PlaceSearch apiKey={apiKey} placeholder={t.header.search} fallbackLabel={t.places.fallback} disabled={state.status === 'loading'} onSelect={(place) => void analyzeLocation(place)} />
        </div>
        <div className="relative hidden sm:block">
          <button type="button" onClick={() => setExamplesOpen((open) => !open)} className="h-12 rounded-2xl border border-white/10 bg-slate-950/90 px-4 text-sm shadow-xl backdrop-blur-xl hover:bg-slate-900">
            {t.header.examples}⌄
          </button>
          {examplesOpen && (
            <div className="absolute left-0 top-14 w-52 rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl">
              {DEMO_BUILDINGS.map((building) => (
                <button key={building.id} type="button" onClick={() => void analyzeLocation({ label: t.places[building.id], latitude: building.latitude, longitude: building.longitude })} className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10">
                  {building.borough}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')} aria-label={t.switchLabel} className="h-12 shrink-0 rounded-2xl border border-white/10 bg-slate-950/90 px-4 text-sm font-semibold shadow-xl backdrop-blur-xl hover:bg-slate-900">
          {t.switchTo}
        </button>
      </header>

      {state.status === 'idle' && (
        <section className="pointer-events-none absolute left-5 top-24 z-20 max-w-sm rounded-2xl border border-white/10 bg-slate-950/75 p-4 shadow-xl backdrop-blur-lg">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-sky-300">NYC Solar Roof</p>
          <h1 className="mt-2 text-lg font-semibold">{t.intro.title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">{t.intro.body}</p>
        </section>
      )}

      {state.status === 'loading' && (
        <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/90 px-4 py-2 text-xs text-sky-200 shadow-xl backdrop-blur-xl">
          {t.loadingPill}
        </div>
      )}

      {(state.status === 'no-data' || state.status === 'error') && (
        <section className="absolute left-1/2 top-1/2 z-30 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/10 bg-slate-950/94 p-6 text-center shadow-2xl backdrop-blur-xl">
          <p className="text-sm font-semibold text-amber-300">{t.cannotAnalyze}</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{t.messages[state.message]}</p>
          <button type="button" onClick={resetWorkspace} className="mt-5 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-950">{t.reselect}</button>
        </section>
      )}

      {state.status === 'ready' && state.insights && summary && workspaceMode === 'focus' && (
        <section className="absolute bottom-8 right-5 z-20 w-[min(360px,calc(100vw-2.5rem))] rounded-3xl border border-white/10 bg-slate-950/92 p-5 shadow-2xl backdrop-blur-xl lg:bottom-auto lg:top-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">{t.focus.eyebrow}</p>
          <h2 className="mt-2 line-clamp-2 text-lg font-semibold">{state.locationLabel}</h2>
          <p className="mt-3 text-xs leading-5 text-slate-400">{t.focus.meta(t.quality[state.insights.imageryQuality], formatDate(state.insights), panels.length)}</p>
          {dataWarning && <p className="mt-2 text-xs text-amber-300">{t.warnings[dataWarning]}</p>}
          <div className="mt-5 space-y-2">
            <button type="button" onClick={() => void enter3DDesign()} className="w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold hover:bg-sky-400">{t.focus.enter3d}</button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setDesignSurface('2d'); enterDesign(); }} className="rounded-xl bg-white/10 px-4 py-3 text-sm font-medium hover:bg-white/15">{t.focus.design2d}</button>
              <button type="button" onClick={() => setWorkspaceMode('sun')} className="rounded-xl bg-white/10 px-4 py-3 text-sm font-medium hover:bg-white/15">{t.focus.viewSun}</button>
            </div>
          </div>
        </section>
      )}

      {state.status === 'ready' && workspaceMode !== 'focus' && workspaceMode !== 'explore' && (
        <nav className="absolute right-5 top-5 z-30 flex rounded-2xl border border-white/10 bg-slate-950/90 p-1 shadow-xl backdrop-blur-xl">
          {([
            ['design', t.tabs.design],
            ['sun', t.tabs.sun],
            ['results', t.tabs.results],
          ] as const).map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => { setWorkspaceMode(mode); setEditMode(false); setPlaying(false); }} className={`rounded-xl px-4 py-2 text-sm transition ${workspaceMode === mode ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}>
              {label}
            </button>
          ))}
        </nav>
      )}

      {state.status === 'ready' && workspaceMode !== 'focus' && workspaceMode !== 'explore' && (
        <div className="absolute left-1/2 top-5 z-30 flex -translate-x-1/2 rounded-2xl border border-white/10 bg-slate-950/90 p-1 shadow-xl backdrop-blur-xl">
          <button type="button" onClick={() => setDesignSurface('2d')} className={`rounded-xl px-4 py-2 text-xs ${designSurface === '2d' ? 'bg-white text-slate-950' : 'text-slate-300'}`}>{t.surface.roof2d}</button>
          <button type="button" onClick={() => void enter3DDesign()} className={`rounded-xl px-4 py-2 text-xs ${designSurface === '3d' ? 'bg-white text-slate-950' : 'text-slate-300'}`}>{t.surface.isolated3d}</button>
        </div>
      )}

      {state.status === 'ready' && workspaceMode !== 'focus' && workspaceMode !== 'explore' && (
        <div className="absolute left-5 top-24 z-30 flex w-14 flex-col gap-1 rounded-2xl border border-white/10 bg-slate-950/92 p-1.5 shadow-xl backdrop-blur-xl">
          <ToolButton label={t.tools.select} symbol="↖" active={workspaceMode === 'design' && !editMode} onClick={() => { setWorkspaceMode('design'); setEditMode(false); }} />
          <ToolButton label={t.tools.place} symbol="▦" active={workspaceMode === 'design' && editMode} onClick={() => { setWorkspaceMode('design'); setEditMode(true); }} />
          <ToolButton label={t.tools.sun} symbol="☀" active={workspaceMode === 'sun'} onClick={() => { setWorkspaceMode('sun'); setEditMode(false); }} />
          <ToolButton label={t.tools.results} symbol="Σ" active={workspaceMode === 'results'} onClick={() => { setWorkspaceMode('results'); setEditMode(false); }} />
        </div>
      )}

      {state.status === 'ready' && state.insights && summary && workspaceMode === 'design' && designSurface === '2d' && (
        <aside className="absolute right-5 top-20 z-20 max-h-[calc(100vh-6.25rem)] w-[min(360px,calc(100vw-2.5rem))] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/92 p-5 shadow-2xl backdrop-blur-xl">
          <PanelHeader eyebrow={t.design2d.eyebrow} title={t.design2d.title(summary.panelCount, summary.capacityKw.toFixed(1))} closeLabel={t.closePanel} onClose={() => setWorkspaceMode('focus')} />
          <p className="mt-2 text-xs leading-5 text-slate-400">{t.design2d.intro}</p>

          <div className="mt-5 space-y-2">
            {presets.map((preset) => {
              const active = state.selected.size === preset.count && state.overrides.size === 0;
              return (
                <button key={preset.id} type="button" onClick={() => { dispatch({ type: 'select-count', count: preset.count }); setEditMode(false); }} className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${active ? 'border-sky-400 bg-sky-500/15' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'}`}>
                  <span className="text-sm font-medium">{t.design2d.presets[preset.id]}</span>
                  <span className="text-xs text-slate-400">{t.design2d.panels(preset.count)}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{t.design2d.count}</span>
              <span className="font-semibold text-white">{state.selected.size} / {panels.length}</span>
            </div>
            <input aria-label={t.design2d.count} type="range" min="0" max={panels.length} step="1" value={state.selected.size} onChange={(event) => dispatch({ type: 'select-count', count: Number(event.target.value) })} className="mt-3 h-2 w-full cursor-pointer accent-sky-400" />
          </div>

          <button type="button" onClick={() => setEditMode((editing) => !editing)} className={`mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold ${editMode ? 'bg-white text-slate-950' : 'bg-sky-500 text-white hover:bg-sky-400'}`}>
            {editMode ? t.design2d.finishEdit : t.design2d.fineTune}
          </button>

          {editMode && (
            <div className="mt-3 rounded-2xl border border-sky-400/20 bg-sky-500/10 p-3">
              <p className="text-xs leading-5 text-sky-100">{t.design2d.editHint}</p>
              <p className="mt-3 text-[11px] font-semibold text-slate-300">{t.design2d.groupRotation}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button type="button" onClick={() => dispatch({ type: 'rotate-selected', degrees: -5 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">↶ 5°</button>
                <button type="button" onClick={() => dispatch({ type: 'rotate-selected', degrees: 90 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">{t.portraitLandscape}</button>
                <button type="button" onClick={() => dispatch({ type: 'rotate-selected', degrees: 5 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">5° ↷</button>
              </div>
              {state.activePanel !== null && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <p className="mb-2 text-[11px] text-slate-400">{t.design2d.activePanel(state.activePanel + 1)}</p>
                  <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => dispatch({ type: 'rotate', index: state.activePanel!, degrees: -15 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">↶ 15°</button>
                  <button type="button" onClick={() => dispatch({ type: 'rotate', index: state.activePanel!, degrees: 90 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">{t.portraitLandscape}</button>
                  <button type="button" onClick={() => dispatch({ type: 'rotate', index: state.activePanel!, degrees: 15 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">15° ↷</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {state.overrides.size > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              <span>{t.design2d.moved(state.overrides.size)}</span>
              <button type="button" onClick={() => dispatch({ type: 'reset-custom' })} className="underline">{t.design2d.restore}</button>
            </div>
          )}

          <button type="button" onClick={() => { setWorkspaceMode('sun'); setEditMode(false); }} className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-300">{t.design2d.nextSun}</button>
          <p className="mt-4 text-[11px] leading-5 text-slate-500">{t.design2d.footnote}</p>
        </aside>
      )}

      {state.status === 'ready' && summary && workspaceMode === 'sun' && (
        <aside className="absolute right-5 top-20 z-20 w-[min(300px,calc(100vw-2.5rem))] rounded-3xl border border-white/10 bg-slate-950/88 p-4 shadow-2xl backdrop-blur-xl">
          <PanelHeader eyebrow={t.sun.eyebrow} title={formatNewYorkTime(simulationDate)} closeLabel={t.closePanel} onClose={() => setWorkspaceMode('focus')} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <SunMetric label={t.sun.azimuth} value={sun ? `${sun.azimuthDegrees.toFixed(1)}°` : '—'} />
            <SunMetric label={t.sun.altitude} value={sun ? `${sun.altitudeDegrees.toFixed(1)}°` : '—'} />
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">{t.sun.direct(Math.round(activeLightAverage * 100), is3D)}</p>
        </aside>
      )}

      {state.status === 'ready' && state.insights && activeSummary && workspaceMode === 'results' && (
        <aside className="absolute right-5 top-20 z-20 max-h-[calc(100vh-6.25rem)] w-[min(370px,calc(100vw-2.5rem))] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/92 p-5 shadow-2xl backdrop-blur-xl">
          <PanelHeader eyebrow={is3D ? t.results.eyebrow3d : t.results.eyebrow} title={t.results.title(activeSummary.capacityKw.toFixed(1))} closeLabel={t.closePanel} onClose={() => setWorkspaceMode('focus')} />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Metric label={t.results.panels} value={t.results.panelCount(activeSummary.panelCount)} detail={is3D ? t.results.layout3d : t.results.layout} />
            <Metric label={is3D ? t.results.energy3d : t.results.energy} value={`${Math.round(activeSummary.annualAcKwh).toLocaleString()} kWh`} detail={is3D ? t.results.energyDetail3d : t.results.energyDetail} />
            <Metric label={is3D ? t.results.carbon3d : t.results.carbon} value={`${Math.round(activeSummary.annualCarbonKg).toLocaleString()} kg`} detail={t.results.carbonDetail} />
            <Metric label={t.results.direct} value={`${Math.round(activeLightAverage * 100)}%`} detail={t.results.directDetail} />
          </div>
          {is3D && <p className="mt-3 text-[11px] leading-5 text-slate-500">{t.results.note3d}</p>}
          <label className="mt-5 block text-xs text-slate-400" htmlFor="rate">{t.results.rate}</label>
          <input id="rate" type="number" min="0" step="0.001" value={electricityRate} onChange={(event) => setElectricityRate(Number(event.target.value) || 0)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400" />
          <button type="button" onClick={() => void copyShareLink()} className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold hover:bg-sky-400">{t.results.share}</button>
          {shareMessage && <p className="mt-2 text-center text-xs text-emerald-300">{t.share[shareMessage]}</p>}
          <div className="mt-5 border-t border-white/10 pt-4 text-[11px] leading-5 text-slate-500">
            <p>{t.results.imagery(t.quality[state.insights.imageryQuality], formatDate(state.insights))}</p>
            <p>{t.results.derate}</p>
          </div>
        </aside>
      )}

      {workspaceMode === 'sun' && state.status === 'ready' && (
        <section className="absolute bottom-5 left-5 right-5 z-30 rounded-2xl border border-white/10 bg-slate-950/92 px-4 py-3 shadow-2xl backdrop-blur-xl lg:right-[340px]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <input aria-label={t.sun.date} type="date" value={dateIso} onChange={(event) => setDateIso(event.target.value)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
              <button type="button" onClick={() => setPlaying((value) => !value)} className="grid h-9 w-9 place-items-center rounded-full bg-amber-400 text-sm font-semibold text-slate-950" aria-label={playing ? t.sun.pause : t.sun.play}>
                {playing ? 'Ⅱ' : '▶'}
              </button>
            </div>
            <div className="flex flex-1 items-center gap-3">
              <span className="w-12 font-mono text-sm text-amber-200">{minuteLabel(minuteOfDay)}</span>
              <input aria-label={t.sun.time} type="range" min="0" max="1439" step="5" value={minuteOfDay} onChange={(event) => { setPlaying(false); setMinuteOfDay(Number(event.target.value)); }} className="solar-time-slider h-2 flex-1 cursor-pointer" />
            </div>
          </div>
        </section>
      )}

      <p className={`pointer-events-none absolute bottom-2 left-5 z-20 text-[10px] text-white/55 ${workspaceMode === 'sun' ? 'hidden' : ''}`}>
        {t.attribution}
      </p>
    </main>
  );
}

function PanelHeader({ eyebrow, title, closeLabel, onClose }: { eyebrow: string; title: string; closeLabel: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-semibold">{title}</h2>
      </div>
      <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label={closeLabel}>×</button>
    </div>
  );
}

function ToolButton({ label, symbol, active, onClick }: { label: string; symbol: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex flex-col items-center rounded-xl px-1 py-2 text-[10px] transition ${active ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-white/10'}`}>
      <span className="text-lg leading-5">{symbol}</span>
      <span className="mt-1">{label}</span>
    </button>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

function SunMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="mt-0.5 font-mono text-sm text-amber-200">{value}</p>
    </div>
  );
}
