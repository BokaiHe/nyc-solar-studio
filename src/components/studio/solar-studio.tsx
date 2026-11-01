'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Map2DCanvas, type FootprintInfo } from '@/components/map-2d-canvas';
import { PlaceSearch } from '@/components/place-search';
import { RoofScene3D, type ViewCommand } from '@/components/roof-scene-3d';
import { createLayoutContext, rackAzimuth, type LayoutContext, type LayoutResult } from '@/lib/design/auto-layout';
import { estimateDesignEnergy } from '@/lib/design/energy';
import { DRAFT_KEY, emptyComparisons, parseDraft, snapshot, type Comparisons, type Draft } from '@/lib/design/workspace';
import { DEFAULT_PANEL_SIZE, DEFAULT_PANEL_WATTS, FLAT_ROOF_DEGREES, panelCenter } from '@/lib/design/geometry';
import { panelClear } from '@/lib/design/clearance';
import { detectObstacles } from '@/lib/design/detect-obstacles';
import { roofCrop, runObstacleModel } from '@/lib/design/obstacle-model';
import { panelInZones } from '@/lib/design/keep-out';
import { collides, rowPanelIds, similarPanelIds, snapToArray } from '@/lib/design/panel-ops';
import { facingAzimuth, type Vec3 } from '@/lib/design/roof-faces';
import { encodeSharedDesign, parseSharedDesign, type SharedDesign } from '@/lib/design/share';
import { TOUR_BUILDING, TOUR_SEEN_KEY, TOUR_STEPS, TOUR_ZONES } from '@/lib/design/tour';
import type { LayoutOption, Objective } from '@/lib/design/optimizer';
import type { LayoutMessage, LayoutRequest } from '@/lib/design/layout.worker';
import type { OptimizerMessage, OptimizerRequest } from '@/lib/design/optimizer.worker';
import { insideStudyArea, STUDY_AREA_BUILDINGS } from '@/lib/nyc/study-area';
import { canDesign, initialStudioState, isUntouchedLayout, sameParams, savedPanels, shadingKey, studioReducer, type LayoutParams, type Tool } from '@/lib/design/state';
import { useI18n } from '@/lib/i18n';
import { loadBasemap, type Basemap } from '@/lib/map-tiles';
import { summarizeDesign } from '@/lib/solar/calculations';
import { DEFAULT_ELECTRICITY_RATE_USD_PER_KWH, DEMO_BUILDINGS, NYC_GRID_CARBON_KG_PER_MWH } from '@/lib/solar/config';
import { currentNewYorkDateAndMinute, getSunSnapshot, newYorkDateTimeToDate, panelDirectLightFactor } from '@/lib/solar/sun';
import type { ConceptPanel, LatLng, RoofModelData } from '@/lib/solar/types';
import type { CityBuilding } from '@/lib/nyc/geometry';
import { findBuildingAt, findBuildingById, neighborMesh, roofModel } from '@/lib/nyc/static-tiles';
import { DesignPanel } from './design-panel';
import { OptimizeCard, type OptimizerState } from './optimize-card';
import { ResultsPanel } from './results-panel';
import { SceneToolbar, ToolHint } from './scene-toolbar';
import { SelectPanel } from './select-panel';
import { SelectionBar } from './selection-bar';
import { StepNav } from './step-nav';
import { SunBar } from './sun-bar';
import { TourOverlay } from './tour-overlay';
import { WorkspaceTools, type ComparisonMetrics } from './workspace-tools';
import { cardClass, pillClass } from './ui';

// The site's path prefix on GitHub Pages (empty locally).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const HOME_PATH = `${BASE_PATH}/`;

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

const TOOL_KEYS: Record<string, Tool> = { v: 'select', a: 'add', e: 'erase', z: 'zone' };
// Debounce for live regeneration while settings are edited.
const LIVE_LAYOUT_DELAY_MS = 150;
// Pause in editing after which annual energy is re-estimated.
const ENERGY_SETTLE_MS = 150;

export function SolarStudio() {
  const { t, lang, setLang } = useI18n();
  const [state, dispatch] = useReducer(studioReducer, initialStudioState);
  const { step, building, panels, selectedIds, tool, params } = state;
  const [mapError, setMapError] = useState<'failed' | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [rate, setRate] = useState(DEFAULT_ELECTRICITY_RATE_USD_PER_KWH);
  const [heatmap, setHeatmap] = useState(false);
  const [comparisons, setComparisons] = useState<Comparisons>(emptyComparisons);
  const [draftOffer, setDraftOffer] = useState<Draft | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [restoredModule, setRestoredModule] = useState<Pick<Draft, 'panelSize' | 'panelWatts'> | null>(null);
  const [copied, setCopied] = useState(false);
  const [dateIso, setDateIso] = useState('2026-06-21');
  const [minuteOfDay, setMinuteOfDay] = useState(12 * 60);
  const [playing, setPlaying] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutResult, setLayoutResult] = useState<Omit<LayoutResult, 'panels'> | null>(null);
  const [view, setView] = useState<ViewCommand>({ kind: 'reset', nonce: 0 });
  // A keep-out area hovered in the side panel's list, outlined in the scene.
  const [highlightedZone, setHighlightedZone] = useState<number | null>(null);
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [loadedBasemap, setLoadedBasemap] = useState<{ buildingId: string; basemap: Basemap } | null>(null);
  const [showBasemap, setShowBasemap] = useState(false);
  const [hoveredBuilding, setHoveredBuilding] = useState<FootprintInfo | null>(null);
  const [outlinesVisible, setOutlinesVisible] = useState(false);
  const [objective, setObjective] = useState<Objective>('max-total');
  const [optimizer, setOptimizer] = useState<(OptimizerState & { base?: LayoutParams })>({ status: 'idle' });
  // The last keep-out detection, for the building it ran on.
  // `model` says whether the trained model ran or the color rule stood in.
  const [detection, setDetection] = useState<{ buildingId: string; status: 'running' | 'done'; count: number; model: boolean } | null>(null);
  // Runs the obstacle model; created on the first detection.
  const obstacleWorkerRef = useRef<Worker | null>(null);
  // The guided tour's step, or null when it is closed.
  const [tourIndex, setTourIndex] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const layoutWorkerRef = useRef<Worker | null>(null);
  const layoutRequestRef = useRef(0);
  const layoutHandlerRef = useRef<((message: LayoutMessage) => void) | null>(null);
  // The context whose roof the layout worker holds.
  const layoutSceneRef = useRef<LayoutContext | null>(null);
  const saveDraftRef = useRef<(() => void) | null>(null);
  const requestRef = useRef(0);
  const didLoadSharedRef = useRef(false);
  const searchParams = useSearchParams();
  const shared = useMemo(() => parseSharedDesign(searchParams.toString()), [searchParams]);

  // Drops any running layout; the next request starts a fresh worker.
  const stopLayoutWorker = useCallback(() => {
    layoutWorkerRef.current?.terminate();
    layoutWorkerRef.current = null;
    layoutSceneRef.current = null;
    layoutRequestRef.current += 1;
  }, []);

  // `buildingId` comes from a clicked footprint outline and skips the point lookup.
  const loadBuilding = useCallback(async (location: LatLng, label: string, sharedDesign?: SharedDesign, buildingId?: string, draft?: Draft) => {
    saveDraftRef.current?.();
    saveDraftRef.current = null;
    const request = ++requestRef.current;
    dispatch({ type: 'select-building', location, label });
    setLayoutResult(null);
    setComparisons(emptyComparisons());
    setRestoredModule(null);
    setSaveStatus('idle');
    workerRef.current?.terminate();
    workerRef.current = null;
    stopLayoutWorker();
    setLayoutBusy(false);
    setOptimizer({ status: 'idle' });
    setExamplesOpen(false);
    if (!sharedDesign && window.location.pathname !== HOME_PATH) window.history.replaceState(null, '', HOME_PATH);
    // No model exists outside the study area; say so without asking the server.
    if (!buildingId && !sharedDesign && !insideStudyArea(location)) {
      dispatch({ type: 'building-failed', status: 'outside' });
      return;
    }
    // Buildings come from the static tiles; a click on a street or yard snaps
    // to the nearest building close by.
    let target: CityBuilding | null;
    try {
      target = buildingId ? await findBuildingById(buildingId, location) : await findBuildingAt(location);
    } catch {
      if (request === requestRef.current) dispatch({ type: 'building-failed', status: 'error' });
      return;
    }
    if (request !== requestRef.current) return;
    let model: RoofModelData | null = null;
    try {
      model = target && roofModel(target);
    } catch {
      model = null;
    }
    if (!target || !model) {
      dispatch({ type: 'building-failed', status: 'no-model' });
      return;
    }
    const sameBuilding = sharedDesign && sharedDesign.buildingId === model.nycBuildingId;
    if (draft && sameBuilding) {
      setComparisons(draft.comparisons);
      setRestoredModule({ panelSize: draft.panelSize, panelWatts: draft.panelWatts });
      setRate(draft.rate);
    }
    setDraftOffer(null);
    dispatch({
      type: 'building-loaded',
      location: model.center,
      model,
      panels: sameBuilding ? sharedDesign.panels : undefined,
      params: draft && sameBuilding ? draft.params : undefined,
      keepOut: sameBuilding ? sharedDesign.keepOut : undefined,
      notice: sharedDesign && !sameBuilding ? 'sharedModelChanged' : null,
    });
    // Surrounding buildings arrive separately so the model shows without waiting.
    const modelId = model.nycBuildingId;
    if (!modelId) return;
    try {
      const neighbors = await neighborMesh(target);
      if (request === requestRef.current) dispatch({ type: 'neighbors-loaded', buildingId: modelId, neighbors });
    } catch {
      if (request === requestRef.current) dispatch({ type: 'neighbors-failed', buildingId: modelId });
    }
  }, [stopLayoutWorker]);

  useEffect(() => {
    if (!shared || didLoadSharedRef.current) return;
    // Mark inside the timeout: Strict Mode cancels the first scheduled run.
    const timeout = window.setTimeout(() => {
      didLoadSharedRef.current = true;
      void loadBuilding(shared.location, t.places.shared, shared, shared.buildingId);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadBuilding, shared, t]);

  useEffect(() => {
    if (shared) return;
    const timer = window.setTimeout(() => {
      try { setDraftOffer(parseDraft(localStorage.getItem(DRAFT_KEY))); }
      catch { setSaveStatus('error'); }
      // A first visit opens the tour's welcome card; shared links go straight to the design.
      try { if (!localStorage.getItem(TOUR_SEEN_KEY)) setTourIndex(0); }
      catch { /* storage unavailable: the Guide button still opens it */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [shared]);

  // Start the simulation on today's New York date at noon, after hydration.
  useEffect(() => {
    const timeout = window.setTimeout(() => setDateIso(currentNewYorkDateAndMinute().dateIso), 0);
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

  const { model, location } = building;
  const panelSize = restoredModule?.panelSize ?? DEFAULT_PANEL_SIZE;
  const minSpacing = panelSize.widthMeters * 0.9;
  // Shared by live updates, so roof analysis and sun visibility are reused.
  const layoutContext = useMemo(() => model ? createLayoutContext(model, building.neighbors) : null, [building.neighbors, model]);
  const roofAxis = layoutContext?.axisDegrees ?? null;

  // Satellite imagery around the building for the 3D view; the scene works
  // without it if the Map Tiles API is unavailable.
  useEffect(() => {
    const buildingId = model?.nycBuildingId;
    if (!model || !buildingId) return;
    const controller = new AbortController();
    const radius = Math.min(250, Math.max(model.widthMeters, model.depthMeters) / 2 + 60);
    loadBasemap(model.center, radius, controller.signal)
      .then((basemap) => setLoadedBasemap({ buildingId, basemap }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [model]);
  const basemap = loadedBasemap && loadedBasemap.buildingId === model?.nycBuildingId ? loadedBasemap.basemap : null;
  const shading = shadingKey(building);
  const sun = useMemo(
    () => location ? getSunSnapshot(newYorkDateTimeToDate(dateIso, minuteOfDay), location.latitude, location.longitude) : null,
    [dateIso, location, minuteOfDay],
  );
  const directLight = useMemo(() => {
    if (!sun || !panels.length) return null;
    return panels.reduce((sum, panel) => sum + panelDirectLightFactor(panel.azimuthDegrees, panel.tiltDegrees, sun), 0) / panels.length;
  }, [panels, sun]);
  const panelWatts = restoredModule?.panelWatts ?? DEFAULT_PANEL_WATTS;
  // Energy follows the design once edits pause, so dragging panels on a big
  // roof does not re-estimate every panel on each pointer move.
  const [energyPanels, setEnergyPanels] = useState(panels);
  useEffect(() => {
    if (energyPanels === panels) return;
    const timer = window.setTimeout(() => setEnergyPanels(panels), ENERGY_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [energyPanels, panels]);
  const energy = useMemo(
    () => (layoutContext ? estimateDesignEnergy(energyPanels, layoutContext, panelSize) : null),
    [energyPanels, layoutContext, panelSize],
  );
  const energyPending = state.moving || energyPanels !== panels || building.neighborStatus === 'loading' || layoutBusy;
  const annualRatios = useMemo(() => {
    if (!heatmap || !energy || !layoutContext) return undefined;
    return new Map(energyPanels.map((panel, i) => [panel.id, layoutContext.idealPanelScore > 0 ? energy.yields[i] / layoutContext.idealPanelScore : 0]));
  }, [energy, energyPanels, heatmap, layoutContext]);
  const selectedPanel = panels.find(p => p.id === selectedIds.at(-1));
  const selectedIndex = selectedPanel ? energyPanels.findIndex(p => p.id === selectedPanel.id) : -1;
  const comparisonMetrics = useMemo(() => {
    const measure = (slot: 'A' | 'B'): ComparisonMetrics | null => {
      const saved = comparisons[slot];
      if (!saved || !layoutContext) return null;
      const calculated = estimateDesignEnergy(saved.panels, layoutContext, panelSize);
      const capacity = saved.panels.length * panelWatts / 1000;
      const annual = calculated.totalYield * panelWatts / 1000;
      return { count: saved.panels.length, capacity, annual, specific: capacity ? annual / capacity : 0 };
    };
    return { A: measure('A'), B: measure('B') };
  }, [comparisons, layoutContext, panelSize, panelWatts]);

  const draftPanels = savedPanels(state);
  // Keep the latest building's design in this browser. Nothing is saved until
  // a layout or a keep-out area exists, so merely opening a building never
  // overwrites a draft; a layout cleared by hand is a design too and is saved.
  useEffect(() => {
    if (!model?.nycBuildingId || !location || layoutBusy || (state.pristine && !params.keepOut.length)) return;
    const buildingId = model.nycBuildingId;
    const save = () => {
      const draft: Draft = {
        version: 1,
        savedAt: new Date().toISOString(),
        buildingId,
        label: building.label,
        location,
        ...snapshot(draftPanels, params),
        comparisons,
        panelSize,
        panelWatts,
        rate,
      };
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    };
    const timer = window.setTimeout(save, 400);
    // Switching buildings saves right away instead of waiting for the timer.
    saveDraftRef.current = save;
    window.addEventListener('pagehide', save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', save);
    };
  }, [building.label, comparisons, draftPanels, layoutBusy, location, model, panelSize, panelWatts, params, rate, state.pristine]);
  const summary = useMemo(() => summarizeDesign({
    panelCount: panels.length,
    panelWatts,
    annualAcKwh: (energy?.totalYield ?? 0) * (panelWatts / 1000),
    efficiency: energy?.efficiency ?? 0,
    carbonKgPerMwh: NYC_GRID_CARBON_KG_PER_MWH,
    electricityRateUsdPerKwh: rate,
  }), [energy, panelWatts, panels.length, rate]);

  // Auto layout runs in a worker that keeps the roof between requests; the
  // roof is sent again only when the main thread's context changes.
  const generate = useCallback((record: boolean) => {
    if (!model || !layoutContext) return;
    let worker = layoutWorkerRef.current;
    if (!worker) {
      const created = new Worker(new URL('../../lib/design/layout.worker.ts', import.meta.url), { type: 'module' });
      created.onmessage = (event: MessageEvent<LayoutMessage>) => layoutHandlerRef.current?.(event.data);
      created.onerror = () => layoutHandlerRef.current?.({ id: layoutRequestRef.current, type: 'error' });
      layoutWorkerRef.current = created;
      worker = created;
    }
    const id = ++layoutRequestRef.current;
    const scene = layoutSceneRef.current === layoutContext ? undefined : { model, neighbors: building.neighbors };
    layoutSceneRef.current = layoutContext;
    const layoutParams = params;
    setLayoutBusy(true);
    layoutHandlerRef.current = (message) => {
      // A newer request supersedes this one.
      if (message.id !== layoutRequestRef.current) return;
      if (message.type === 'done') {
        layoutContext.visibility.seed(message.visibility);
        const { panels: generated, ...result } = message.result;
        dispatch({ type: 'generated', panels: generated, params: layoutParams, shading, record });
        setLayoutResult(result);
      } else {
        stopLayoutWorker();
      }
      setLayoutBusy(false);
    };
    worker.postMessage({ id, scene, params: layoutParams, panel: panelSize } satisfies LayoutRequest);
  }, [building.neighbors, layoutContext, model, panelSize, params, shading, stopLayoutWorker]);

  // The roof starts empty so keep-out areas can be drawn first; once an
  // array is generated, keep it in step with the settings and keep-out areas
  // until it is edited by hand (the panel then offers to apply).
  const untouched = isUntouchedLayout(state);
  const liveTarget = untouched && state.generated && (!sameParams(state.generated.params, params) || state.generated.shading !== shading);
  useEffect(() => {
    if (step !== 'design' || !model || layoutBusy || !liveTarget) return;
    const timer = window.setTimeout(() => generate(false), LIVE_LAYOUT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [generate, layoutBusy, liveTarget, model, step]);

  // A flat roof hit gets a rack with the array settings; a pitched one a flush
  // panel along its slope. The result snaps to a nearby array when one exists.
  const planPanel = useCallback((point: Vec3, normal: Vec3) => {
    const slope = (Math.acos(Math.min(1, normal[1])) * 180) / Math.PI;
    const flush = slope >= FLAT_ROOF_DEGREES;
    const tiltDegrees = flush ? slope : params.tiltDegrees;
    const candidate: Omit<ConceptPanel, 'id'> = {
      position: panelCenter(point, normal, flush ? 'flush' : 'rack', tiltDegrees, panelSize.heightMeters),
      azimuthDegrees: flush ? facingAzimuth(normal) : rackAzimuth(params.azimuthDegrees, params.alignToRoof ? roofAxis : null),
      tiltDegrees,
      landscape: false,
      mount: flush ? 'flush' : 'rack',
    };
    const snapped = snapToArray(candidate, panels, panelSize, params.rowSpacingMeters);
    const panel = snapped ? { ...candidate, position: snapped } : candidate;
    // Hand-placed panels must also stay out of walls and other buildings.
    const clear = (layoutContext ? panelClear(panel, panelSize, layoutContext.occluders) : true)
      && !panelInZones(panel, panelSize, params.keepOut);
    return { panel, valid: clear && !collides(panel.position, panels, minSpacing) };
  }, [layoutContext, minSpacing, panelSize, panels, params, roofAxis]);

  const selectRelated = useCallback((pick: (all: ConceptPanel[], anchor: ConceptPanel) => number[]) => {
    const anchor = panels.find((panel) => panel.id === selectedIds.at(-1));
    if (anchor) dispatch({ type: 'select', ids: pick(panels, anchor), mode: 'replace' });
  }, [panels, selectedIds]);

  useEffect(() => {
    if (step !== 'design') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (mod && key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if (mod && key === 'a') {
        event.preventDefault();
        dispatch({ type: 'set-tool', tool: 'select' });
        dispatch({ type: 'select', ids: panels.map((panel) => panel.id), mode: 'replace' });
      } else if (!mod && !event.altKey && TOOL_KEYS[key]) {
        dispatch({ type: 'set-tool', tool: TOOL_KEYS[key] });
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length) {
        event.preventDefault();
        dispatch({ type: 'remove-panels', ids: selectedIds });
      } else if (event.key === 'Escape') {
        if (selectedIds.length) dispatch({ type: 'select', ids: [], mode: 'replace' });
        else dispatch({ type: 'set-tool', tool: 'select' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panels, selectedIds, step]);

  const sceneHandlers = useMemo(() => ({
    onAddPanel: (panel: Omit<ConceptPanel, 'id'>) => dispatch({ type: 'add-panel', panel, minSpacing }),
    onAddZone: (points: Vec3[]) => dispatch({ type: 'add-zone', points }),
    onRemoveZone: (id: number) => dispatch({ type: 'remove-zone', id }),
    onUpdateZone: (id: number, points: Vec3[]) => dispatch({ type: 'update-zone', id, points }),
    onSelect: (ids: number[], mode: 'replace' | 'add' | 'toggle') => dispatch({ type: 'select', ids, mode }),
    onCheckpoint: () => dispatch({ type: 'checkpoint' }),
    onMovePanels: (positions: Array<[number, Vec3]>, finish = false) => dispatch({ type: 'move-panels', positions, finish, panelSize }),
    onCancelGesture: () => dispatch({ type: 'cancel-move' }),
    onRemovePanels: (ids: number[]) => dispatch({ type: 'remove-panels', ids, record: false }),
  }), [minSpacing, panelSize]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    obstacleWorkerRef.current?.terminate();
    stopLayoutWorker();
  }, [stopLayoutWorker]);

  const runOptimizer = useCallback(() => {
    if (!model) return;
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../../lib/design/optimizer.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const base = params;
    setOptimizer({ status: 'running', done: 0, total: 1 });
    worker.onmessage = (event: MessageEvent<OptimizerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') setOptimizer({ status: 'running', done: message.done, total: message.total });
      else {
        setOptimizer(message.type === 'done' ? { status: 'done', result: message.result, stale: false, base } : { status: 'error' });
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      }
    };
    worker.onerror = () => {
      setOptimizer({ status: 'error' });
      worker.terminate();
    };
    worker.postMessage({ model, neighbors: building.neighbors, params: base, panel: panelSize, objective } satisfies OptimizerRequest);
  }, [building.neighbors, model, objective, panelSize, params]);

  // Apply an option's settings and its already computed layout as one undo step.
  const applyOption = useCallback((option: LayoutOption) => {
    dispatch({ type: 'set-params', params: option.params });
    dispatch({ type: 'generated', panels: option.panels, params: option.params, shading, record: true });
    setLayoutResult(option.result);
  }, [shading]);

  // Results go stale when settings the search held fixed (facing, setback…) change.
  const optimizerView: OptimizerState = optimizer.status === 'done' && optimizer.base
    ? { ...optimizer, stale: !sameParams({ ...optimizer.base, tiltDegrees: params.tiltDegrees, rowSpacingMeters: params.rowSpacingMeters }, params) }
    : optimizer;

  const copyShareLink = useCallback(async () => {
    if (!location || !model?.nycBuildingId) return;
    const path = encodeSharedDesign({ location, buildingId: model.nycBuildingId, panels, keepOut: params.keepOut });
    await navigator.clipboard.writeText(`${window.location.origin}${BASE_PATH}${path}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }, [location, model, panels, params.keepOut]);

  const startOver = useCallback(() => {
    saveDraftRef.current?.();
    saveDraftRef.current = null;
    requestRef.current += 1;
    dispatch({ type: 'reset' });
    workerRef.current?.terminate();
    workerRef.current = null;
    stopLayoutWorker();
    setLayoutBusy(false);
    setOptimizer({ status: 'idle' });
    setComparisons(emptyComparisons());
    setPlaying(false);
    if (window.location.pathname !== HOME_PATH) window.history.replaceState(null, '', HOME_PATH);
  }, [stopLayoutWorker]);

  const restoreDraft = useCallback(() => {
    if (!draftOffer) return;
    const { location: at, label, buildingId, panels: saved } = draftOffer;
    void loadBuilding(at, label, { location: at, buildingId, panels: saved, keepOut: draftOffer.params.keepOut }, buildingId, draftOffer);
  }, [draftOffer, loadBuilding]);

  const discardDraft = useCallback(() => {
    setDraftOffer(null);
    try { localStorage.removeItem(DRAFT_KEY); } catch { setSaveStatus('error'); }
  }, []);

  // Finds rooftop equipment in the aerial imagery with the trained model (or,
  // if it cannot load, the color rule) and marks it as keep-out areas, then
  // shows the plan view over the imagery so they can be checked.
  const detectZones = useCallback(async () => {
    const buildingId = model?.nycBuildingId;
    if (!basemap || !layoutContext || !buildingId) return;
    const request = requestRef.current;
    const kept = params.keepOut.filter((zone) => !zone.auto);
    setDetection({ buildingId, status: 'running', count: 0, model: true });
    let zones;
    let usedModel = true;
    try {
      const crop = roofCrop(basemap, layoutContext.faces);
      if (!crop) throw new Error('No flat roof');
      obstacleWorkerRef.current ??= new Worker(new URL('../../lib/design/obstacle.worker.ts', import.meta.url), { type: 'module' });
      zones = detectObstacles(crop, layoutContext.faces, kept, await runObstacleModel(obstacleWorkerRef.current, crop, BASE_PATH));
    } catch {
      usedModel = false;
      const { canvas, minX, maxX, minZ, maxZ } = basemap;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      zones = detectObstacles({ width: canvas.width, height: canvas.height, data: pixels.data, minX, maxX, minZ, maxZ }, layoutContext.faces, kept);
    }
    // Another building opened meanwhile.
    if (requestRef.current !== request) return;
    dispatch({ type: 'replace-auto-zones', zones });
    setDetection({ buildingId, status: 'done', count: zones.length, model: usedModel });
    setShowBasemap(true);
    setView((current) => (current.kind === 'top' ? current : { kind: 'top', nonce: current.nonce + 1 }));
  }, [basemap, layoutContext, model, params.keepOut]);
  const detect = detection && detection.buildingId === model?.nycBuildingId ? detection : { status: 'idle' as const, count: 0, model: true };

  const closeTour = useCallback(() => {
    setTourIndex(null);
    try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch { /* shown again next visit */ }
  }, []);

  // Each step of the tour is performed on the example building as it opens.
  const advanceTour = useCallback(() => {
    if (tourIndex === null) return;
    const next = tourIndex + 1;
    const id = TOUR_STEPS[next]?.id;
    if (id === 'search') {
      void loadBuilding(TOUR_BUILDING.location, t.tour.place, undefined, TOUR_BUILDING.id);
    } else if (id === 'design') {
      dispatch({ type: 'set-step', step: 'design' });
      dispatch({ type: 'set-tool', tool: 'select' });
      setShowBasemap(true);
      setView((current) => ({ kind: 'top', nonce: current.nonce + 1 }));
    } else if (id === 'zones') {
      if (!params.keepOut.length) for (const points of TOUR_ZONES) dispatch({ type: 'add-zone', points });
    } else if (id === 'generate') {
      generate(true);
    } else if (id === 'sun') {
      setView((current) => ({ kind: 'reset', nonce: current.nonce + 1 }));
      setDateIso((current) => `${current.slice(0, 4)}-12-21`);
      setMinuteOfDay(14 * 60 + 30);
    } else if (id === 'results') {
      dispatch({ type: 'set-step', step: 'results' });
    }
    setTourIndex(next);
  }, [generate, loadBuilding, params.keepOut.length, t, tourIndex]);

  const tourStep = tourIndex === null ? null : TOUR_STEPS[tourIndex].id;
  const tourReady = tourStep === 'search' || tourStep === 'building' ? building.status === 'ready' && model?.nycBuildingId === TOUR_BUILDING.id
    : tourStep === 'zones' ? params.keepOut.length > 0
    : tourStep === 'generate' ? !layoutBusy && panels.length > 0
    : true;

  const designReady = canDesign(state);
  const editing = step === 'design';
  const showScene = step !== 'select' && model;
  const workspace = (
    <WorkspaceTools
      heatmap={heatmap}
      onHeatmap={() => setHeatmap((value) => !value)}
      selected={selectedPanel}
      selectedKwh={energy && selectedIndex >= 0 ? (energy.yields[selectedIndex] * panelWatts) / 1000 : undefined}
      busy={energyPending}
      saveStatus={saveStatus}
      comparisons={comparisons}
      metrics={comparisonMetrics}
      onSave={(slot) => setComparisons((current) => ({ ...current, [slot]: snapshot(panels, params) }))}
      onApply={(slot) => {
        const saved = comparisons[slot];
        if (!saved) return;
        dispatch({ type: 'restore-layout', ...snapshot(saved.panels, saved.params) });
        setLayoutResult(null);
      }}
    />
  );

  return (
    <main className="relative h-dvh min-h-[520px] overflow-hidden bg-[#e9edf2] text-label">
      {/* The map stays mounted so returning to the select step does not reload it. */}
      <div className={step === 'select' ? '' : 'invisible'}>
        <Map2DCanvas
          location={location}
          showMarker={building.status !== 'idle'}
          selectedBuildingId={building.model?.nycBuildingId ?? null}
          onSelectLocation={(picked) => void loadBuilding(picked, t.places.mapPick)}
          onSelectBuilding={(picked, point) => void loadBuilding(point, picked.address || t.places.mapPick, undefined, picked.id)}
          onHoverBuilding={setHoveredBuilding}
          onOutlinesVisibleChange={setOutlinesVisible}
          onMapError={() => setMapError('failed')}
        />
      </div>
      {showScene && (
        <RoofScene3D
          key={model.nycBuildingId}
          model={model}
          panels={panels}
          annualRatios={energyPending ? undefined : annualRatios}
          panelSize={panelSize}
          selectedIds={selectedIds}
          sun={sun}
          tool={tool}
          editable={editing}
          view={view}
          planPanel={planPanel}
          zones={params.keepOut}
          highlightedZone={highlightedZone}
          neighbors={showNeighbors ? building.neighbors : null}
          basemap={showBasemap ? basemap : null}
          {...sceneHandlers}
        />
      )}

      <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-3 md:p-4">
        <header className="flex flex-wrap items-start gap-2">
          <button type="button" onClick={startOver} className={`${pillClass} grid h-11 w-11 shrink-0 place-items-center text-[15px] font-bold tracking-[-0.02em] transition active:scale-95`} aria-label={t.header.home}>
            SR
          </button>
          {/* Its own full-width row on phones; inline on wider screens. */}
          <div data-tour="search" className={`${pillClass} order-last w-full p-1.5 md:order-none md:w-[360px]`}>
            <PlaceSearch
              placeholder={t.header.search}
              disabled={building.status === 'loading'}
              onSelect={(place) => void loadBuilding({ latitude: place.latitude, longitude: place.longitude }, place.label)}
            />
          </div>
          <div className="relative">
            <button type="button" onClick={() => setExamplesOpen((open) => !open)} aria-expanded={examplesOpen} aria-label={t.header.examples} className={`${pillClass} h-11 px-3 text-[13px] font-medium transition active:scale-[0.97]`}>
              <span className="hidden sm:inline">{t.header.examples} </span>⌄
            </button>
            {examplesOpen && (
              <div className={`${cardClass} absolute left-0 top-12 z-10 w-56 p-1.5`}>
                {DEMO_BUILDINGS.map((demo) => (
                  <button key={demo.id} type="button" onClick={() => void loadBuilding({ latitude: demo.latitude, longitude: demo.longitude }, t.places[demo.id])} className="block w-full rounded-[9px] px-3 py-2 text-left text-[13px] transition hover:bg-accent hover:text-white">
                    {t.places[demo.id]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')} aria-label={t.switchLabel} className={`${pillClass} h-11 px-3 text-[13px] font-semibold transition active:scale-[0.97]`}>
            {t.switchTo}
          </button>
          <div className="ml-auto flex items-start gap-2">
            <button type="button" onClick={() => setTourIndex(0)} aria-label={t.tour.label} title={t.tour.label} className={`${pillClass} flex h-11 items-center gap-1.5 px-3 text-[13px] font-semibold transition active:scale-[0.97]`}>
              <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[12px] text-white">?</span>
              <span className="hidden xl:inline">{t.tour.button}</span>
            </button>
            <StepNav step={step} designReady={designReady} onChange={(next) => dispatch({ type: 'set-step', step: next })} />
          </div>
        </header>

        {draftOffer && step === 'select' && (
          <section className={`${cardClass} max-w-lg self-start p-3 text-[13px]`} aria-label={t.workspace.draftTitle}>
            <p className="font-semibold">{t.workspace.draftTitle}</p>
            <p className="mt-1 text-label-secondary">
              {t.workspace.draftDetail(draftOffer.label, draftOffer.panels.length, new Date(draftOffer.savedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US'))}
            </p>
            <div className="mt-2 flex gap-3">
              <button type="button" disabled={building.status === 'loading'} className="font-semibold text-accent disabled:opacity-40" onClick={restoreDraft}>{t.workspace.restore}</button>
              <button type="button" onClick={discardDraft}>{t.workspace.discard}</button>
            </div>
          </section>
        )}

        <div className="flex min-h-0 flex-1 flex-col justify-between gap-3 md:flex-row md:items-start">
          {showScene ? (
            <SceneToolbar
              tool={tool}
              editable={editing}
              onToolChange={(next) => dispatch({ type: 'set-tool', tool: next })}
              onResetView={() => setView((current) => ({ kind: 'reset', nonce: current.nonce + 1 }))}
              planView={view.kind === 'top'}
              onTopView={() => setView((current) => ({ kind: current.kind === 'top' ? 'reset' : 'top', nonce: current.nonce + 1 }))}
              neighborsAvailable={building.neighborStatus === 'ready' && (building.neighbors?.buildingCount ?? 0) > 0}
              showNeighbors={showNeighbors}
              onToggleNeighbors={() => setShowNeighbors((value) => !value)}
              basemapAvailable={basemap !== null}
              showBasemap={showBasemap}
              onToggleBasemap={() => setShowBasemap((value) => !value)}
            />
          ) : <span />}
          {mapError && step === 'select' ? (
            <div className={`${cardClass} h-fit w-full p-5 text-[15px] text-label md:w-[340px]`}>{t.map[mapError]}</div>
          ) : step === 'select' ? (
            <SelectPanel building={building} onStart={() => dispatch({ type: 'set-step', step: 'design' })} />
          ) : step === 'design' ? (
            <DesignPanel
              state={state}
              capacityKw={summary.capacityKw}
              dispatch={dispatch}
              onGenerate={() => generate(true)}
              onHighlightZone={setHighlightedZone}
              onDetectZones={basemap && layoutContext ? () => void detectZones() : null}
              detect={detect}
              layoutBusy={layoutBusy}
              neighborStatus={building.neighborStatus}
              neighborCount={building.neighbors?.buildingCount ?? 0}
              layoutResult={layoutResult}
              workspace={workspace}
              onNext={() => dispatch({ type: 'set-step', step: 'results' })}
              optimizer={(
                <OptimizeCard
                  objective={objective}
                  onObjectiveChange={setObjective}
                  state={optimizerView}
                  panelWatts={panelWatts}
                  appliedKey={untouched ? `${params.tiltDegrees}:${params.rowSpacingMeters}` : null}
                  onRun={runOptimizer}
                  onApply={applyOption}
                />
              )}
            />
          ) : (
            <ResultsPanel
              summary={summary}
              workspace={workspace}
              rate={rate}
              onRateChange={setRate}
              onShare={() => void copyShareLink()}
              copied={copied}
              onBack={() => dispatch({ type: 'set-step', step: 'design' })}
              onDrawKeepOut={() => {
                dispatch({ type: 'set-step', step: 'design' });
                dispatch({ type: 'set-tool', tool: 'zone' });
              }}
              keepOutCount={params.keepOut.length}
              panelSize={panelSize}
              panelWatts={panelWatts}
              modelRelease={model?.modelRelease ?? '2017'}
            />
          )}
        </div>

        <footer className="flex flex-col items-center gap-2">
          {step === 'select' ? (
            <p className={`${pillClass} px-3 py-1.5 text-[12px] ${hoveredBuilding ? 'font-medium text-label' : 'text-label-secondary'}`}>
              {hoveredBuilding
                ? t.map.hover(hoveredBuilding.address || t.places.fallback, hoveredBuilding.height)
                : outlinesVisible ? t.map.hintPick : t.map.hintZoom(STUDY_AREA_BUILDINGS.toLocaleString())}
            </p>
          ) : (
            <>
              {editing && selectedIds.length > 0 && (
                <SelectionBar
                  count={selectedIds.length}
                  onRotate={(degrees) => dispatch({ type: 'transform-panels', ids: selectedIds, azimuthDelta: degrees, panelSize })}
                  onToggleOrientation={() => dispatch({ type: 'transform-panels', ids: selectedIds, toggleLandscape: true, panelSize })}
                  onSelectRow={() => selectRelated(rowPanelIds)}
                  onSelectRoof={() => selectRelated(similarPanelIds)}
                  onSelectAll={() => dispatch({ type: 'select', ids: panels.map((panel) => panel.id), mode: 'replace' })}
                  onDelete={() => dispatch({ type: 'remove-panels', ids: selectedIds })}
                  onDeselect={() => dispatch({ type: 'select', ids: [], mode: 'replace' })}
                />
              )}
              {editing && selectedIds.length === 0 && <ToolHint tool={tool} editable={editing} planView={view.kind === 'top'} />}
              <div className="pointer-events-auto">
                <SunBar
                  dateIso={dateIso}
                  onDateChange={setDateIso}
                  minuteOfDay={minuteOfDay}
                  onMinuteChange={setMinuteOfDay}
                  playing={playing}
                  onPlayingChange={setPlaying}
                  sun={sun}
                  directLight={directLight}
                />
              </div>
            </>
          )}
          <p className={`hidden self-start text-[10px] md:block ${step === 'select' ? 'text-white/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]' : 'text-label-tertiary'}`}>{t.attribution}</p>
        </footer>
      </div>
      {tourIndex !== null && <TourOverlay index={tourIndex} ready={tourReady} onNext={advanceTour} onClose={closeTour} />}
    </main>
  );
}
