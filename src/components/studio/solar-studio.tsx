'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Map2DCanvas } from '@/components/map-2d-canvas';
import { PlaceSearch } from '@/components/place-search';
import { RoofScene3D } from '@/components/roof-scene-3d';
import { autoLayout, rackAzimuth, type LayoutResult } from '@/lib/design/auto-layout';
import { DEFAULT_PANEL_SIZE, DEFAULT_PANEL_WATTS, FLAT_ROOF_DEGREES, panelCenter } from '@/lib/design/geometry';
import { dominantAxisDegrees, extractRoofFaces, facingAzimuth, type Vec3 } from '@/lib/design/roof-faces';
import { encodeSharedDesign, parseSharedDesign, type SharedDesign } from '@/lib/design/share';
import { canDesign, initialStudioState, studioReducer } from '@/lib/design/state';
import { useI18n } from '@/lib/i18n';
import { summarizeDesign } from '@/lib/solar/calculations';
import { DEFAULT_ELECTRICITY_RATE_USD_PER_KWH, DEMO_BUILDINGS } from '@/lib/solar/config';
import { currentNewYorkDateAndMinute, getSunSnapshot, newYorkDateTimeToDate, panelDirectLightFactor } from '@/lib/solar/sun';
import type { BuildingInsights, ConceptPanel, LatLng, RoofModelData } from '@/lib/solar/types';
import { DesignPanel } from './design-panel';
import { ResultsPanel } from './results-panel';
import { SelectPanel } from './select-panel';
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

export function SolarStudio() {
  const { t, lang, setLang } = useI18n();
  const [state, dispatch] = useReducer(studioReducer, initialStudioState);
  const { step, building, panels, selectedId } = state;
  const [mapError, setMapError] = useState<'forbidden' | 'failed' | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [rate, setRate] = useState(DEFAULT_ELECTRICITY_RATE_USD_PER_KWH);
  const [copied, setCopied] = useState(false);
  const [sunOpen, setSunOpen] = useState(false);
  const [dateIso, setDateIso] = useState('2026-06-21');
  const [minuteOfDay, setMinuteOfDay] = useState(12 * 60);
  const [playing, setPlaying] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutResult, setLayoutResult] = useState<Omit<LayoutResult, 'panels'> | null>(null);
  const requestRef = useRef(0);
  const didLoadSharedRef = useRef(false);
  const searchParams = useSearchParams();
  const shared = useMemo(() => parseSharedDesign(searchParams.toString()), [searchParams]);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  const loadBuilding = useCallback(async (location: LatLng, label: string, sharedDesign?: SharedDesign) => {
    const request = ++requestRef.current;
    dispatch({ type: 'select-building', location, label });
    setLayoutResult(null);
    setExamplesOpen(false);
    if (!sharedDesign && window.location.pathname !== '/') window.history.replaceState(null, '', '/');
    const query = `lat=${location.latitude}&lng=${location.longitude}`;
    const [direct, solar] = await Promise.allSettled([
      fetchJson<RoofModelData>(`/api/solar/roof-model?${query}`),
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

  useEffect(() => {
    if (step !== 'design') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId !== null) {
        event.preventDefault();
        dispatch({ type: 'remove-panel', id: selectedId });
      } else if (event.key === 'Escape') {
        dispatch({ type: 'select-panel', id: null });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, step]);

  const { model, insights, location } = building;
  const potential = insights?.solarPotential ?? null;
  const panelSize = useMemo(() => potential
    ? { widthMeters: potential.panelWidthMeters, heightMeters: potential.panelHeightMeters }
    : DEFAULT_PANEL_SIZE, [potential]);
  const roofAxis = useMemo(() => model ? dominantAxisDegrees(extractRoofFaces(model)) : null, [model]);
  const sun = useMemo(
    () => location ? getSunSnapshot(newYorkDateTimeToDate(dateIso, minuteOfDay), location.latitude, location.longitude) : null,
    [dateIso, location, minuteOfDay],
  );
  const directLight = useMemo(() => {
    if (!sun || !panels.length) return null;
    return panels.reduce((sum, panel) => sum + panelDirectLightFactor(panel.azimuthDegrees, panel.tiltDegrees, sun), 0) / panels.length;
  }, [panels, sun]);
  const summary = useMemo(
    () => summarizeDesign(panels.length, potential, potential?.panelCapacityWatts ?? DEFAULT_PANEL_WATTS, rate),
    [panels.length, potential, rate],
  );

  const runAutoLayout = useCallback(() => {
    if (!model) return;
    setLayoutBusy(true);
    // Yield a frame so the busy state paints before the synchronous layout runs.
    window.setTimeout(() => {
      const { panels: generated, ...result } = autoLayout(model, state.params, panelSize);
      dispatch({ type: 'set-panels', panels: generated });
      setLayoutResult(result);
      setLayoutBusy(false);
    }, 30);
  }, [model, panelSize, state.params]);

  // A clicked flat roof gets a rack with the array settings; a pitched roof gets
  // a flush panel following its slope.
  const addPanelAt = useCallback((point: Vec3, normal: Vec3) => {
    const slope = (Math.acos(Math.min(1, normal[1])) * 180) / Math.PI;
    const flush = slope >= FLAT_ROOF_DEGREES;
    const tiltDegrees = flush ? slope : state.params.tiltDegrees;
    const panel: Omit<ConceptPanel, 'id'> = {
      position: panelCenter(point, normal, flush ? 'flush' : 'rack', tiltDegrees, panelSize.heightMeters),
      azimuthDegrees: flush
        ? facingAzimuth(normal)
        : rackAzimuth(state.params.azimuthDegrees, state.params.alignToRoof ? roofAxis : null),
      tiltDegrees,
      landscape: false,
      mount: flush ? 'flush' : 'rack',
    };
    dispatch({ type: 'add-panel', panel, minSpacing: panelSize.widthMeters * 0.7 });
  }, [panelSize, roofAxis, state.params]);

  const movePanel = useCallback((id: number, point: Vec3, normal: Vec3) => {
    const panel = panels.find((item) => item.id === id);
    if (!panel) return;
    const length = panel.landscape ? panelSize.widthMeters : panelSize.heightMeters;
    dispatch({ type: 'drag-move', id, position: panelCenter(point, normal, panel.mount, panel.tiltDegrees, length) });
  }, [panelSize, panels]);

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
    setPlaying(false);
    setSunOpen(false);
    if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
  }, []);

  if (!apiKey) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <section className={`${cardClass} max-w-lg p-8`}>
          <p className="text-sm font-semibold text-amber-700">{t.apiKey.title}</p>
          <h1 className="mt-2 text-2xl font-semibold">NYC Solar Studio</h1>
          <p className="mt-4 leading-7 text-slate-600">{t.apiKey.before}<code>.env.local</code>{t.apiKey.after}</p>
        </section>
      </main>
    );
  }

  const designReady = canDesign(state);
  const showScene = step !== 'select' && model;

  return (
    <main className="relative h-dvh min-h-[560px] overflow-hidden bg-slate-200 text-slate-900">
      {/* The map stays mounted so returning to the select step does not reload it. */}
      <div className={step === 'select' ? '' : 'invisible'}>
        <Map2DCanvas
          apiKey={apiKey}
          location={location}
          buildingBounds={insights?.boundingBox}
          showMarker={building.status !== 'idle'}
          onSelectLocation={(picked) => void loadBuilding(picked, t.places.mapPick)}
          onMapError={(message) => setMapError(message?.includes('403') ? 'forbidden' : 'failed')}
        />
      </div>
      {showScene && (
        <RoofScene3D
          model={model}
          panels={panels}
          panelSize={panelSize}
          selectedId={selectedId}
          sun={sun}
          editable={step === 'design'}
          onAddPanel={addPanelAt}
          onSelectPanel={(id) => dispatch({ type: 'select-panel', id })}
          onDragStart={(id) => dispatch({ type: 'drag-start', id })}
          onDragMove={movePanel}
        />
      )}

      <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-4">
        <header className="flex flex-wrap items-start gap-2">
          <button type="button" onClick={startOver} className={`${pillClass} grid h-12 w-12 shrink-0 place-items-center text-sm font-black tracking-tight`} aria-label={t.header.home}>
            SR
          </button>
          <div className={`${pillClass} w-[min(360px,calc(100vw-9rem))] p-1.5`}>
            <PlaceSearch
              apiKey={apiKey}
              placeholder={t.header.search}
              fallbackLabel={t.places.fallback}
              disabled={building.status === 'loading'}
              onSelect={(place) => void loadBuilding({ latitude: place.latitude, longitude: place.longitude }, place.label)}
            />
          </div>
          <div className="relative">
            <button type="button" onClick={() => setExamplesOpen((open) => !open)} aria-expanded={examplesOpen} className={`${pillClass} h-12 px-4 text-sm hover:bg-slate-50`}>
              {t.header.examples} ⌄
            </button>
            {examplesOpen && (
              <div className={`${cardClass} absolute left-0 top-14 z-10 w-56 p-2`}>
                {DEMO_BUILDINGS.map((demo) => (
                  <button key={demo.id} type="button" onClick={() => void loadBuilding({ latitude: demo.latitude, longitude: demo.longitude }, t.places[demo.id])} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-100">
                    {t.places[demo.id]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')} aria-label={t.switchLabel} className={`${pillClass} h-12 px-4 text-sm font-semibold hover:bg-slate-50`}>
            {t.switchTo}
          </button>
          <div className="ml-auto">
            <StepNav step={step} designReady={designReady} onChange={(next) => dispatch({ type: 'set-step', step: next })} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 items-start justify-end">
          {mapError && step === 'select' ? (
            <div className={`${cardClass} h-fit w-[min(360px,100%)] p-5 text-sm text-amber-800`}>{t.map[mapError]}</div>
          ) : step === 'select' ? (
            <SelectPanel building={building} onStart={() => dispatch({ type: 'set-step', step: 'design' })} />
          ) : step === 'design' ? (
            <DesignPanel
              state={state}
              capacityKw={summary.capacityKw}
              dispatch={dispatch}
              onAutoLayout={runAutoLayout}
              layoutBusy={layoutBusy}
              layoutResult={layoutResult}
              onNext={() => dispatch({ type: 'set-step', step: 'results' })}
            />
          ) : (
            <ResultsPanel
              summary={summary}
              hasGoogleData={potential !== null}
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
            <p className="rounded-full bg-slate-950/70 px-3 py-1.5 text-[11px] text-white/85 backdrop-blur-md">{t.map.hint}</p>
          ) : (
            <SunBar
              open={sunOpen}
              onToggle={() => { setSunOpen((open) => !open); setPlaying(false); }}
              dateIso={dateIso}
              onDateChange={setDateIso}
              minuteOfDay={minuteOfDay}
              onMinuteChange={setMinuteOfDay}
              playing={playing}
              onPlayingChange={setPlaying}
              sun={sun}
              directLight={directLight}
            />
          )}
          <p className={`self-start text-[10px] ${step === 'select' ? 'text-white/70' : 'text-slate-500'}`}>{t.attribution}</p>
        </footer>
      </div>
    </main>
  );
}
