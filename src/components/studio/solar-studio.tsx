'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Map2DCanvas, type FootprintInfo } from '@/components/map-2d-canvas';
import { PlaceSearch } from '@/components/place-search';
import { RoofScene3D, type ViewCommand } from '@/components/roof-scene-3d';
import { autoLayout, createLayoutContext, rackAzimuth, type LayoutResult } from '@/lib/design/auto-layout';
import { estimateDesignEnergy } from '@/lib/design/energy';
import { DEFAULT_PANEL_SIZE, DEFAULT_PANEL_WATTS, FLAT_ROOF_DEGREES, panelCenter } from '@/lib/design/geometry';
import { panelClear } from '@/lib/design/clearance';
import { collides, rowPanelIds, similarPanelIds, snapToArray } from '@/lib/design/panel-ops';
import { facingAzimuth, type Vec3 } from '@/lib/design/roof-faces';
import { encodeSharedDesign, parseSharedDesign, type SharedDesign } from '@/lib/design/share';
import type { LayoutOption, Objective } from '@/lib/design/optimizer';
import type { OptimizerMessage, OptimizerRequest } from '@/lib/design/optimizer.worker';
import { insideStudyArea, STUDY_AREA_BUILDINGS } from '@/lib/nyc/study-area';
import { canDesign, initialStudioState, isUntouchedLayout, sameParams, shadingKey, studioReducer, type LayoutParams, type Tool } from '@/lib/design/state';
import { useI18n } from '@/lib/i18n';
import { summarizeDesign } from '@/lib/solar/calculations';
import { DEFAULT_ELECTRICITY_RATE_USD_PER_KWH, DEMO_BUILDINGS } from '@/lib/solar/config';
import { currentNewYorkDateAndMinute, getSunSnapshot, newYorkDateTimeToDate, panelDirectLightFactor } from '@/lib/solar/sun';
import type { BuildingInsights, ConceptPanel, LatLng, NeighborMesh, RoofModelData } from '@/lib/solar/types';
import { DesignPanel } from './design-panel';
import { OptimizeCard, type OptimizerState } from './optimize-card';
import { ResultsPanel } from './results-panel';
import { SceneToolbar, ToolHint } from './scene-toolbar';
import { SelectPanel } from './select-panel';
import { SelectionBar } from './selection-bar';
import { StepNav } from './step-nav';
import { SunBar } from './sun-bar';
import { cardClass, pillClass } from './ui';

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new HttpError(response.status);
  return response.json() as Promise<T>;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

const TOOL_KEYS: Record<string, Tool> = { v: 'select', a: 'add', e: 'erase' };
// Debounce for live regeneration while settings are edited.
const LIVE_LAYOUT_DELAY_MS = 150;

export function SolarStudio() {
  const { t, lang, setLang } = useI18n();
  const [state, dispatch] = useReducer(studioReducer, initialStudioState);
  const { step, building, panels, selectedIds, tool, params } = state;
  const [mapError, setMapError] = useState<'forbidden' | 'failed' | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [rate, setRate] = useState(DEFAULT_ELECTRICITY_RATE_USD_PER_KWH);
  const [copied, setCopied] = useState(false);
  const [dateIso, setDateIso] = useState('2026-06-21');
  const [minuteOfDay, setMinuteOfDay] = useState(12 * 60);
  const [playing, setPlaying] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutResult, setLayoutResult] = useState<Omit<LayoutResult, 'panels'> | null>(null);
  const [view, setView] = useState<ViewCommand>({ kind: 'reset', nonce: 0 });
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [hoveredBuilding, setHoveredBuilding] = useState<FootprintInfo | null>(null);
  const [outlinesVisible, setOutlinesVisible] = useState(false);
  const [objective, setObjective] = useState<Objective>('max-total');
  const [optimizer, setOptimizer] = useState<(OptimizerState & { base?: LayoutParams })>({ status: 'idle' });
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const didLoadSharedRef = useRef(false);
  const searchParams = useSearchParams();
  const shared = useMemo(() => parseSharedDesign(searchParams.toString()), [searchParams]);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  // `buildingId` comes from a clicked footprint outline and skips the point lookup.
  const loadBuilding = useCallback(async (location: LatLng, label: string, sharedDesign?: SharedDesign, buildingId?: string) => {
    const request = ++requestRef.current;
    dispatch({ type: 'select-building', location, label });
    setLayoutResult(null);
    workerRef.current?.terminate();
    workerRef.current = null;
    setOptimizer({ status: 'idle' });
    setExamplesOpen(false);
    if (!sharedDesign && window.location.pathname !== '/') window.history.replaceState(null, '', '/');
    // No model exists outside the study area; say so without asking the server.
    if (!buildingId && !sharedDesign && !insideStudyArea(location)) {
      dispatch({ type: 'building-failed', status: 'outside' });
      return;
    }
    const query = `lat=${location.latitude}&lng=${location.longitude}`;
    const [direct, solar] = await Promise.allSettled([
      fetchJson<RoofModelData>(buildingId ? `/api/solar/roof-model?id=${encodeURIComponent(buildingId)}` : `/api/solar/roof-model?${query}`),
      fetchJson<BuildingInsights>(`/api/solar?${query}`),
    ]);
    let model = direct;
    // A click on a street or yard misses every footprint; Google snaps to the
    // nearest building, so retry the model lookup at its center.
    if (model.status === 'rejected' && model.reason instanceof HttpError && model.reason.status === 404 && solar.status === 'fulfilled') {
      const { latitude, longitude } = solar.value.center;
      [model] = await Promise.allSettled([fetchJson<RoofModelData>(`/api/solar/roof-model?lat=${latitude}&lng=${longitude}`)]);
    }
    if (request !== requestRef.current) return;
    if (model.status === 'rejected') {
      const missing = model.reason instanceof HttpError && model.reason.status === 404;
      dispatch({ type: 'building-failed', status: missing ? 'no-model' : 'error' });
      return;
    }
    const insights = solar.status === 'fulfilled' && solar.value.solarPotential?.solarPanels?.length ? solar.value : null;
    const sameBuilding = sharedDesign && sharedDesign.buildingId === model.value.nycBuildingId;
    dispatch({
      type: 'building-loaded',
      location: model.value.center,
      model: model.value,
      insights,
      panels: sameBuilding ? sharedDesign.panels : undefined,
      notice: sharedDesign && !sameBuilding ? 'sharedModelChanged' : null,
    });
    // Surrounding buildings arrive separately so the model shows without waiting.
    const modelId = model.value.nycBuildingId;
    if (!modelId) return;
    try {
      const neighbors = await fetchJson<NeighborMesh>(`/api/solar/neighbors?id=${encodeURIComponent(modelId)}`);
      if (request === requestRef.current) dispatch({ type: 'neighbors-loaded', buildingId: modelId, neighbors });
    } catch {
      if (request === requestRef.current) dispatch({ type: 'neighbors-failed', buildingId: modelId });
    }
  }, []);

  useEffect(() => {
    if (!shared || didLoadSharedRef.current) return;
    // Mark inside the timeout: Strict Mode cancels the first scheduled run.
    const timeout = window.setTimeout(() => {
      didLoadSharedRef.current = true;
      void loadBuilding(shared.location, t.places.shared, shared);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadBuilding, shared, t]);

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

  const { model, insights, location } = building;
  const potential = insights?.solarPotential ?? null;
  const panelSize = useMemo(() => potential
    ? { widthMeters: potential.panelWidthMeters, heightMeters: potential.panelHeightMeters }
    : DEFAULT_PANEL_SIZE, [potential]);
  const minSpacing = panelSize.widthMeters * 0.9;
  // Shared by live updates, so roof analysis and sun visibility are reused.
  const layoutContext = useMemo(() => model ? createLayoutContext(model, building.neighbors) : null, [building.neighbors, model]);
  const roofAxis = layoutContext?.axisDegrees ?? null;
  const shading = shadingKey(building);
  const sun = useMemo(
    () => location ? getSunSnapshot(newYorkDateTimeToDate(dateIso, minuteOfDay), location.latitude, location.longitude) : null,
    [dateIso, location, minuteOfDay],
  );
  const directLight = useMemo(() => {
    if (!sun || !panels.length) return null;
    return panels.reduce((sum, panel) => sum + panelDirectLightFactor(panel.azimuthDegrees, panel.tiltDegrees, sun), 0) / panels.length;
  }, [panels, sun]);
  const panelWatts = potential?.panelCapacityWatts ?? DEFAULT_PANEL_WATTS;
  // Energy follows the design a beat behind so drags stay smooth on big roofs.
  const energyPanels = useDeferredValue(panels);
  const energy = useMemo(
    () => (layoutContext ? estimateDesignEnergy(energyPanels, layoutContext, panelSize) : null),
    [energyPanels, layoutContext, panelSize],
  );
  const summary = useMemo(() => summarizeDesign({
    panelCount: panels.length,
    panelWatts,
    annualAcKwh: (energy?.totalYield ?? 0) * (panelWatts / 1000),
    efficiency: energy?.efficiency ?? 0,
    carbonKgPerMwh: potential?.carbonOffsetFactorKgPerMwh ?? null,
    electricityRateUsdPerKwh: rate,
  }), [energy, panelWatts, panels.length, potential, rate]);

  const generate = useCallback((record: boolean) => {
    if (!model || !layoutContext) return;
    setLayoutBusy(true);
    const layoutParams = params;
    // Yield a frame so the busy state paints before the synchronous layout runs.
    window.setTimeout(() => {
      const { panels: generated, ...result } = autoLayout(model, layoutParams, panelSize, layoutContext);
      dispatch({ type: 'generated', panels: generated, params: layoutParams, shading, record });
      setLayoutResult(result);
      setLayoutBusy(false);
    }, 30);
  }, [layoutContext, model, panelSize, params, shading]);

  // Fill the roof on first entry, and keep an untouched layout in step with
  // the settings. Hand edits pause this; the panel then offers to apply.
  const untouched = isUntouchedLayout(state);
  // The first fill waits for the surrounding buildings so it is scored once, with their shade.
  const fresh = state.generated === null && panels.length === 0 && state.past.length === 0 && building.neighborStatus !== 'loading';
  const liveTarget = untouched && state.generated && (!sameParams(state.generated.params, params) || state.generated.shading !== shading);
  useEffect(() => {
    if (step !== 'design' || !model || layoutBusy || !(fresh || liveTarget)) return;
    const timer = window.setTimeout(() => generate(fresh), fresh ? 0 : LIVE_LAYOUT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [fresh, generate, layoutBusy, liveTarget, model, step]);

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
    const clear = layoutContext ? panelClear(panel, panelSize, layoutContext.occluders) : true;
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
    onSelect: (ids: number[], mode: 'replace' | 'add' | 'toggle') => dispatch({ type: 'select', ids, mode }),
    onCheckpoint: () => dispatch({ type: 'checkpoint' }),
    onMovePanels: (positions: Array<[number, Vec3]>) => dispatch({ type: 'move-panels', positions }),
    onCancelGesture: () => dispatch({ type: 'undo' }),
    onRemovePanels: (ids: number[]) => dispatch({ type: 'remove-panels', ids, record: false }),
  }), [minSpacing]);

  useEffect(() => () => workerRef.current?.terminate(), []);

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
    const path = encodeSharedDesign({ location, buildingId: model.nycBuildingId, panels });
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }, [location, model, panels]);

  const startOver = useCallback(() => {
    requestRef.current += 1;
    dispatch({ type: 'reset' });
    workerRef.current?.terminate();
    workerRef.current = null;
    setOptimizer({ status: 'idle' });
    setPlaying(false);
    if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
  }, []);

  if (!apiKey) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#e9edf2] p-6">
        <section className={`${cardClass} max-w-lg p-8`}>
          <p className="text-[13px] font-semibold text-warning">{t.apiKey.title}</p>
          <h1 className="mt-1 text-[28px] font-bold tracking-[-0.02em]">NYC Solar Studio</h1>
          <p className="mt-3 text-[15px] leading-6 text-label-secondary">{t.apiKey.before}<code>.env.local</code>{t.apiKey.after}</p>
        </section>
      </main>
    );
  }

  const designReady = canDesign(state);
  const editing = step === 'design';
  const showScene = step !== 'select' && model;

  return (
    <main className="relative h-dvh min-h-[520px] overflow-hidden bg-[#e9edf2] text-label">
      {/* The map stays mounted so returning to the select step does not reload it. */}
      <div className={step === 'select' ? '' : 'invisible'}>
        <Map2DCanvas
          apiKey={apiKey}
          location={location}
          buildingBounds={insights?.boundingBox}
          showMarker={building.status !== 'idle'}
          selectedBuildingId={building.model?.nycBuildingId ?? null}
          onSelectLocation={(picked) => void loadBuilding(picked, t.places.mapPick)}
          onSelectBuilding={(picked, point) => void loadBuilding(point, picked.address || t.places.mapPick, undefined, picked.id)}
          onHoverBuilding={setHoveredBuilding}
          onOutlinesVisibleChange={setOutlinesVisible}
          onMapError={(message) => setMapError(message?.includes('403') ? 'forbidden' : 'failed')}
        />
      </div>
      {showScene && (
        <RoofScene3D
          key={model.nycBuildingId}
          model={model}
          panels={panels}
          panelSize={panelSize}
          selectedIds={selectedIds}
          sun={sun}
          tool={tool}
          editable={editing}
          view={view}
          planPanel={planPanel}
          neighbors={showNeighbors ? building.neighbors : null}
          {...sceneHandlers}
        />
      )}

      <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-3 md:p-4">
        <header className="flex flex-wrap items-start gap-2">
          <button type="button" onClick={startOver} className={`${pillClass} grid h-11 w-11 shrink-0 place-items-center text-[15px] font-bold tracking-[-0.02em] transition active:scale-95`} aria-label={t.header.home}>
            SR
          </button>
          {/* Its own full-width row on phones; inline on wider screens. */}
          <div className={`${pillClass} order-last w-full p-1.5 md:order-none md:w-[360px]`}>
            <PlaceSearch
              apiKey={apiKey}
              placeholder={t.header.search}
              fallbackLabel={t.places.fallback}
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
          <div className="ml-auto">
            <StepNav step={step} designReady={designReady} onChange={(next) => dispatch({ type: 'set-step', step: next })} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col justify-between gap-3 md:flex-row md:items-start">
          {showScene ? (
            <SceneToolbar
              tool={tool}
              editable={editing}
              onToolChange={(next) => dispatch({ type: 'set-tool', tool: next })}
              onResetView={() => setView((current) => ({ kind: 'reset', nonce: current.nonce + 1 }))}
              onTopView={() => setView((current) => ({ kind: 'top', nonce: current.nonce + 1 }))}
              neighborsAvailable={building.neighborStatus === 'ready' && (building.neighbors?.buildingCount ?? 0) > 0}
              showNeighbors={showNeighbors}
              onToggleNeighbors={() => setShowNeighbors((value) => !value)}
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
              layoutBusy={layoutBusy}
              neighborStatus={building.neighborStatus}
              neighborCount={building.neighbors?.buildingCount ?? 0}
              layoutResult={layoutResult}
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
              rate={rate}
              onRateChange={setRate}
              onShare={() => void copyShareLink()}
              copied={copied}
              onBack={() => dispatch({ type: 'set-step', step: 'design' })}
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
                  onRotate={(degrees) => dispatch({ type: 'transform-panels', ids: selectedIds, azimuthDelta: degrees })}
                  onToggleOrientation={() => dispatch({ type: 'transform-panels', ids: selectedIds, toggleLandscape: true })}
                  onSelectRow={() => selectRelated(rowPanelIds)}
                  onSelectRoof={() => selectRelated(similarPanelIds)}
                  onSelectAll={() => dispatch({ type: 'select', ids: panels.map((panel) => panel.id), mode: 'replace' })}
                  onDelete={() => dispatch({ type: 'remove-panels', ids: selectedIds })}
                  onDeselect={() => dispatch({ type: 'select', ids: [], mode: 'replace' })}
                />
              )}
              {editing && selectedIds.length === 0 && <ToolHint tool={tool} editable={editing} />}
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
    </main>
  );
}
