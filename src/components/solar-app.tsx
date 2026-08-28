'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Map3DCanvas, type Map3DHandle, type MapLocation } from './map-3d-canvas';
import { PlaceSearch, type SelectedPlace } from './place-search';
import { calculateSolarSummary } from '@/lib/solar/calculations';
import { DEFAULT_ELECTRICITY_RATE_USD_PER_KWH, DEMO_BUILDINGS } from '@/lib/solar/config';
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
  type SharedDesign,
} from '@/lib/solar/share-state';
import type {
  BuildingInsights,
  CameraState,
  LatLng,
  PanelOverride,
  RenderPanel,
} from '@/lib/solar/types';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'no-data' | 'error';
type WorkspaceMode = 'explore' | 'focus' | 'design' | 'sun' | 'results';

type State = {
  status: LoadStatus;
  location: MapLocation | null;
  locationLabel: string;
  insights: BuildingInsights | null;
  selected: Set<number>;
  overrides: Map<number, PanelOverride>;
  activePanel: number | null;
  baseCount: number;
  message: string;
};

type Action =
  | { type: 'loading'; location: MapLocation; label: string }
  | { type: 'loaded'; insights: BuildingInsights; selected?: Set<number>; baseCount?: number }
  | { type: 'no-data' }
  | { type: 'error'; message: string }
  | { type: 'toggle'; index: number }
  | { type: 'move'; index: number; center: LatLng }
  | { type: 'rotate'; index: number; degrees: number }
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
  message: '搜索地址，或直接在三维城市中点击一栋建筑。',
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loading':
      return { ...initialState, status: 'loading', location: action.location, locationLabel: action.label, message: '正在读取屋顶光伏数据…' };
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
        message: '点击候选板位添加；按住光伏板拖动可自定义位置。',
      };
    case 'no-data':
      return { ...state, status: 'no-data', insights: null, selected: new Set(), overrides: new Map(), activePanel: null, message: '这栋建筑暂无可用的精细屋顶数据。' };
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

function qualityLabel(quality: BuildingInsights['imageryQuality']): string {
  return { HIGH: '高精度', MEDIUM: '中等精度', BASE: '基础精度' }[quality];
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
  const [state, dispatch] = useReducer(reducer, initialState);
  const [electricityRate, setElectricityRate] = useState(DEFAULT_ELECTRICITY_RATE_USD_PER_KWH);
  const [shareMessage, setShareMessage] = useState('');
  const [dataWarning, setDataWarning] = useState('');
  const [dateIso, setDateIso] = useState('2026-06-21');
  const [minuteOfDay, setMinuteOfDay] = useState(12 * 60);
  const [playing, setPlaying] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('explore');
  const [editMode, setEditMode] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const mapRef = useRef<Map3DHandle>(null);
  const didLoadSharedRef = useRef(false);
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
          setDataWarning('Google 屋顶数据已更新，当前布局可能与分享时不同。');
        }
      }
      dispatch({ type: 'loaded', insights, selected, baseCount });
      setWorkspaceMode(shared ? 'design' : 'focus');
      setEditMode(false);
      setExamplesOpen(false);
    } catch {
      dispatch({ type: 'error', message: 'Solar 服务暂时不可用，请稍后重试。' });
    }
  }, []);

  useEffect(() => {
    if (didLoadSharedRef.current) return;
    if (!sharedDesign) return;
    const timeout = window.setTimeout(() => {
      if (didLoadSharedRef.current) return;
      didLoadSharedRef.current = true;
      void analyzeLocation({
        label: '分享的纽约屋顶方案',
        latitude: sharedDesign.latitude,
        longitude: sharedDesign.longitude,
      }, sharedDesign);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [analyzeLocation, sharedDesign]);

  const summary = useMemo(
    () => state.insights
      ? calculateSolarSummary(state.insights.solarPotential, state.selected, electricityRate)
      : null,
    [electricityRate, state.insights, state.selected],
  );

  const presets = useMemo(() => {
    const configs = state.insights?.solarPotential.solarPanelConfigs ?? [];
    if (!configs.length) return [];
    const indices = [
      Math.floor((configs.length - 1) / 3),
      Math.floor(((configs.length - 1) * 2) / 3),
      configs.length - 1,
    ];
    return [
      { label: '小型方案', count: configs[indices[0]].panelsCount },
      { label: '均衡方案', count: configs[indices[1]].panelsCount },
      { label: 'Google 铺满', count: configs[indices[2]].panelsCount },
    ].filter((item, index, items) => items.findIndex((candidate) => candidate.count === item.count) === index);
  }, [state.insights]);

  const selectedLightAverage = useMemo(() => {
    if (!state.selected.size) return 0;
    const total = [...state.selected].reduce((sum, index) => sum + (panelLightFactors.get(index) ?? 0), 0);
    return total / state.selected.size;
  }, [panelLightFactors, state.selected]);

  const roofHeightMeters = useMemo(
    () => Math.max(0, ...(state.insights?.solarPotential.roofSegmentStats.map((segment) => segment.planeHeightAtCenterMeters) ?? [0])),
    [state.insights],
  );

  const copyShareLink = useCallback(async () => {
    if (!state.insights || !state.location) return;
    const base = new Set(Array.from({ length: state.baseCount }, (_, index) => index));
    const removed = [...base].filter((index) => !state.selected.has(index));
    const added = [...state.selected].filter((index) => !base.has(index));
    const path = encodeSharedDesign({
      latitude: state.location.latitude,
      longitude: state.location.longitude,
      baseCount: state.baseCount,
      added,
      removed,
      imageryDate: state.insights.imageryDate,
      panelCount: state.insights.solarPotential.solarPanels.length,
      camera: mapRef.current?.getCamera() ?? { heading: 25, tilt: 55, range: 135 },
    });
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setShareMessage(state.overrides.size ? '已复制；自定义拖动位置暂未写入链接' : '链接已复制');
  }, [state]);

  const initialCamera: CameraState | undefined = sharedDesign?.camera;

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
  }, []);

  if (!apiKey) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <section className="max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-8">
          <p className="text-sm font-semibold text-amber-300">需要配置 API Key</p>
          <h1 className="mt-2 text-2xl font-semibold">NYC Solar Roof 3D</h1>
          <p className="mt-4 leading-7 text-slate-300">请在 <code>.env.local</code> 中填写 Google Maps 与 Solar API Key。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="relative h-screen min-h-[720px] overflow-hidden bg-slate-950 text-white">
      <Map3DCanvas
        ref={mapRef}
        apiKey={apiKey}
        location={mapFocusLocation}
        roofHeightMeters={roofHeightMeters}
        panels={visiblePanels}
        selectedIndices={state.selected}
        panelLightFactors={panelLightFactors}
        sunDate={simulationDate}
        sun={sun}
        showSun={workspaceMode === 'sun'}
        showBuildingMarker={state.status === 'loading' || workspaceMode === 'focus'}
        allowPanelEditing={workspaceMode === 'design' && editMode}
        allowLocationSelection={workspaceMode === 'explore' || workspaceMode === 'focus'}
        initialCamera={initialCamera}
        onTogglePanel={(index) => dispatch({ type: 'toggle', index })}
        onMovePanel={(index, center) => dispatch({ type: 'move', index, center })}
        onSelectLocation={(location) => void analyzeLocation({ ...location, label: '地图点击的建筑' })}
        onMapError={(message) => dispatch({
          type: 'error',
          message: message?.includes('403')
            ? 'Google Map Tiles API 尚未启用或 Key 没有权限。'
            : '三维城市加载失败，请检查 Map Tiles API。',
        })}
      />

      <header className="absolute left-4 right-4 top-4 z-30 flex items-start gap-2 lg:left-5 lg:right-auto">
        <button type="button" onClick={resetWorkspace} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-slate-950/90 text-sm font-black tracking-tight shadow-xl backdrop-blur-xl" aria-label="返回探索">
          SR
        </button>
        <div className="w-[min(390px,calc(100vw-5.5rem))] rounded-2xl border border-white/10 bg-slate-950/90 p-1.5 shadow-xl backdrop-blur-xl">
          <PlaceSearch apiKey={apiKey} disabled={state.status === 'loading'} onSelect={(place) => void analyzeLocation(place)} />
        </div>
        <div className="relative hidden sm:block">
          <button type="button" onClick={() => setExamplesOpen((open) => !open)} className="h-12 rounded-2xl border border-white/10 bg-slate-950/90 px-4 text-sm shadow-xl backdrop-blur-xl hover:bg-slate-900">
            示例⌄
          </button>
          {examplesOpen && (
            <div className="absolute left-0 top-14 w-52 rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl">
              {DEMO_BUILDINGS.map((building) => (
                <button key={building.id} type="button" onClick={() => void analyzeLocation({ label: building.label, latitude: building.latitude, longitude: building.longitude })} className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10">
                  {building.borough}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {state.status === 'idle' && (
        <section className="pointer-events-none absolute left-5 top-24 z-20 max-w-sm rounded-2xl border border-white/10 bg-slate-950/75 p-4 shadow-xl backdrop-blur-lg">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-sky-300">NYC Solar Roof</p>
          <h1 className="mt-2 text-lg font-semibold">在真实三维城市里设计屋顶光伏</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">搜索地址，或旋转地图后点击屋顶开始。</p>
        </section>
      )}

      {state.status === 'loading' && (
        <div className="absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/90 px-4 py-2 text-xs text-sky-200 shadow-xl backdrop-blur-xl">
          正在读取屋顶数据…
        </div>
      )}

      {(state.status === 'no-data' || state.status === 'error') && (
        <section className="absolute left-1/2 top-1/2 z-30 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/10 bg-slate-950/94 p-6 text-center shadow-2xl backdrop-blur-xl">
          <p className="text-sm font-semibold text-amber-300">当前建筑无法分析</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{state.message}</p>
          <button type="button" onClick={resetWorkspace} className="mt-5 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-950">重新选择</button>
        </section>
      )}

      {state.status === 'ready' && state.insights && summary && workspaceMode === 'focus' && (
        <section className="absolute bottom-8 right-5 z-20 w-[min(360px,calc(100vw-2.5rem))] rounded-3xl border border-white/10 bg-slate-950/92 p-5 shadow-2xl backdrop-blur-xl lg:bottom-auto lg:top-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">已锁定建筑</p>
          <h2 className="mt-2 line-clamp-2 text-lg font-semibold">{state.locationLabel}</h2>
          <p className="mt-3 text-xs leading-5 text-slate-400">{qualityLabel(state.insights.imageryQuality)}影像 · {formatDate(state.insights)} · {panels.length} 个候选板位</p>
          {dataWarning && <p className="mt-2 text-xs text-amber-300">{dataWarning}</p>}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={enterDesign} className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold hover:bg-sky-400">开始设计</button>
            <button type="button" onClick={() => setWorkspaceMode('sun')} className="rounded-xl bg-white/10 px-4 py-3 text-sm font-medium hover:bg-white/15">查看日照</button>
          </div>
        </section>
      )}

      {state.status === 'ready' && workspaceMode !== 'focus' && workspaceMode !== 'explore' && (
        <nav className="absolute right-5 top-5 z-30 flex rounded-2xl border border-white/10 bg-slate-950/90 p-1 shadow-xl backdrop-blur-xl">
          {([
            ['design', '设计'],
            ['sun', '日照'],
            ['results', '结果'],
          ] as const).map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => { setWorkspaceMode(mode); setEditMode(false); setPlaying(false); }} className={`rounded-xl px-4 py-2 text-sm transition ${workspaceMode === mode ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}>
              {label}
            </button>
          ))}
        </nav>
      )}

      {state.status === 'ready' && state.insights && summary && workspaceMode === 'design' && (
        <aside className="absolute right-5 top-20 z-20 max-h-[calc(100vh-6.25rem)] w-[min(360px,calc(100vw-2.5rem))] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/92 p-5 shadow-2xl backdrop-blur-xl">
          <PanelHeader eyebrow="光伏设计" title={`${summary.panelCount} 块 · ${summary.capacityKw.toFixed(1)} kW`} onClose={() => setWorkspaceMode('focus')} />
          <p className="mt-2 text-xs leading-5 text-slate-400">先选推荐规模，需要微调时再进入编辑。</p>

          <div className="mt-5 space-y-2">
            {presets.map((preset) => {
              const active = state.selected.size === preset.count && state.overrides.size === 0;
              return (
                <button key={preset.label} type="button" onClick={() => { dispatch({ type: 'select-count', count: preset.count }); setEditMode(false); }} className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${active ? 'border-sky-400 bg-sky-500/15' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'}`}>
                  <span className="text-sm font-medium">{preset.label}</span>
                  <span className="text-xs text-slate-400">{preset.count} 块</span>
                </button>
              );
            })}
          </div>

          <button type="button" onClick={() => setEditMode((editing) => !editing)} className={`mt-4 w-full rounded-xl px-4 py-3 text-sm font-semibold ${editMode ? 'bg-white text-slate-950' : 'bg-sky-500 text-white hover:bg-sky-400'}`}>
            {editMode ? '完成编辑' : '微调板位'}
          </button>

          {editMode && (
            <div className="mt-3 rounded-2xl border border-sky-400/20 bg-sky-500/10 p-3">
              <p className="text-xs leading-5 text-sky-100">浅色轮廓为候选位置。点击可增删，按住已选板可拖动。</p>
              {state.activePanel !== null && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => dispatch({ type: 'rotate', index: state.activePanel!, degrees: -15 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">↶ 15°</button>
                  <button type="button" onClick={() => dispatch({ type: 'rotate', index: state.activePanel!, degrees: 90 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">横 / 竖</button>
                  <button type="button" onClick={() => dispatch({ type: 'rotate', index: state.activePanel!, degrees: 15 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">15° ↷</button>
                </div>
              )}
            </div>
          )}

          {state.overrides.size > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              <span>{state.overrides.size} 块已移动</span>
              <button type="button" onClick={() => dispatch({ type: 'reset-custom' })} className="underline">恢复推荐位置</button>
            </div>
          )}

          <button type="button" onClick={() => { setWorkspaceMode('sun'); setEditMode(false); }} className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-amber-300">下一步：日照模拟</button>
          <p className="mt-4 text-[11px] leading-5 text-slate-500">拖动布局属于概念设计；Google 年发电基准仍对应原始推荐板位。</p>
        </aside>
      )}

      {state.status === 'ready' && summary && workspaceMode === 'sun' && (
        <aside className="absolute right-5 top-20 z-20 w-[min(300px,calc(100vw-2.5rem))] rounded-3xl border border-white/10 bg-slate-950/88 p-4 shadow-2xl backdrop-blur-xl">
          <PanelHeader eyebrow="太阳位置" title={formatNewYorkTime(simulationDate)} onClose={() => setWorkspaceMode('focus')} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <SunMetric label="方位角" value={sun ? `${sun.azimuthDegrees.toFixed(1)}°` : '—'} />
            <SunMetric label="高度角" value={sun ? `${sun.altitudeDegrees.toFixed(1)}°` : '—'} />
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">当前板面相对直射 {Math.round(selectedLightAverage * 100)}%。拖动下方时间轴观察一天变化。</p>
        </aside>
      )}

      {state.status === 'ready' && state.insights && summary && workspaceMode === 'results' && (
        <aside className="absolute right-5 top-20 z-20 max-h-[calc(100vh-6.25rem)] w-[min(370px,calc(100vw-2.5rem))] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/92 p-5 shadow-2xl backdrop-blur-xl">
          <PanelHeader eyebrow="方案结果" title={`${summary.capacityKw.toFixed(1)} kW 屋顶系统`} onClose={() => setWorkspaceMode('focus')} />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Metric label="光伏板" value={`${summary.panelCount} 块`} detail="400 W / 块" />
            <Metric label="年发电基准" value={`${Math.round(summary.annualAcKwh).toLocaleString()} kWh`} detail="Google 推荐布局" />
            <Metric label="年减碳基准" value={`${Math.round(summary.annualCarbonKg).toLocaleString()} kg`} detail="基于当地电网" />
            <Metric label="当前直射" value={`${Math.round(selectedLightAverage * 100)}%`} detail="几何模拟" />
          </div>
          <label className="mt-5 block text-xs text-slate-400" htmlFor="rate">电价假设（USD/kWh）</label>
          <input id="rate" type="number" min="0" step="0.001" value={electricityRate} onChange={(event) => setElectricityRate(Number(event.target.value) || 0)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400" />
          <button type="button" onClick={() => void copyShareLink()} className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold hover:bg-sky-400">复制方案链接</button>
          {shareMessage && <p className="mt-2 text-center text-xs text-emerald-300">{shareMessage}</p>}
          <div className="mt-5 border-t border-white/10 pt-4 text-[11px] leading-5 text-slate-500">
            <p>{qualityLabel(state.insights.imageryQuality)} · 影像日期 {formatDate(state.insights)}</p>
            <p>年发电量采用 0.85 DC→AC 折减。</p>
          </div>
        </aside>
      )}

      {workspaceMode === 'sun' && state.status === 'ready' && (
        <section className="absolute bottom-5 left-5 right-5 z-30 rounded-2xl border border-white/10 bg-slate-950/92 px-4 py-3 shadow-2xl backdrop-blur-xl lg:right-[340px]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <input aria-label="模拟日期" type="date" value={dateIso} onChange={(event) => setDateIso(event.target.value)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
              <button type="button" onClick={() => setPlaying((value) => !value)} className="grid h-9 w-9 place-items-center rounded-full bg-amber-400 text-sm font-semibold text-slate-950" aria-label={playing ? '暂停' : '播放'}>
                {playing ? 'Ⅱ' : '▶'}
              </button>
            </div>
            <div className="flex flex-1 items-center gap-3">
              <span className="w-12 font-mono text-sm text-amber-200">{minuteLabel(minuteOfDay)}</span>
              <input aria-label="一天中的时间" type="range" min="0" max="1439" step="5" value={minuteOfDay} onChange={(event) => { setPlaying(false); setMinuteOfDay(Number(event.target.value)); }} className="solar-time-slider h-2 flex-1 cursor-pointer" />
            </div>
          </div>
        </section>
      )}

      <p className={`pointer-events-none absolute bottom-2 left-5 z-20 text-[10px] text-white/55 ${workspaceMode === 'sun' ? 'hidden' : ''}`}>
        Includes solar data from Google · 三维瓦片 © Google
      </p>
    </main>
  );
}

function PanelHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-semibold">{title}</h2>
      </div>
      <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="关闭面板">×</button>
    </div>
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
