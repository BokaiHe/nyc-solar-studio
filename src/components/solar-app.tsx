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
      camera: mapRef.current?.getCamera() ?? { heading: 25, tilt: 55, range: 240 },
    });
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setShareMessage(state.overrides.size ? '已复制；自定义拖动位置暂未写入链接' : '链接已复制');
  }, [state]);

  const initialCamera: CameraState | undefined = sharedDesign?.camera;

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
        location={state.location}
        roofHeightMeters={roofHeightMeters}
        panels={panels}
        selectedIndices={state.selected}
        panelLightFactors={panelLightFactors}
        sunDate={simulationDate}
        sun={sun}
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

      <header className="absolute left-4 right-4 top-4 z-20 flex flex-col gap-3 lg:left-6 lg:right-auto lg:w-[430px]">
        <div className="rounded-2xl border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-sky-300">NYC Solar Roof</p>
              <h1 className="mt-1 text-xl font-semibold">三维铺板与太阳轨迹模拟</h1>
            </div>
            <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-300">v0.2</span>
          </div>
          <div className="mt-4">
            <PlaceSearch apiKey={apiKey} disabled={state.status === 'loading'} onSelect={(place) => void analyzeLocation(place)} />
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-400">也可以直接旋转地球并点击任意建筑屋顶。</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {DEMO_BUILDINGS.map((building) => (
              <button
                key={building.id}
                type="button"
                disabled={state.status === 'loading'}
                onClick={() => void analyzeLocation({
                  label: building.label,
                  latitude: building.latitude,
                  longitude: building.longitude,
                })}
                className="rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-xs text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
              >
                {building.borough}
              </button>
            ))}
          </div>
        </div>
      </header>

      <aside className="absolute bottom-36 right-4 z-20 max-h-[calc(100vh-10rem)] w-[min(400px,calc(100vw-2rem))] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/92 p-5 shadow-2xl backdrop-blur-xl lg:right-6 lg:top-6 lg:bottom-36">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">当前建筑</p>
            <h2 className="mt-1 line-clamp-2 font-semibold">{state.locationLabel || '等待选择'}</h2>
          </div>
          {state.status === 'loading' && <span className="animate-pulse text-xs text-sky-300">读取中</span>}
        </div>
        <p className="mt-3 rounded-xl bg-white/5 p-3 text-sm leading-6 text-slate-300">{state.message}</p>
        {dataWarning && <p className="mt-2 text-xs leading-5 text-amber-300">{dataWarning}</p>}

        {state.status === 'ready' && state.insights && summary && (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button key={preset.label} type="button" onClick={() => dispatch({ type: 'select-count', count: preset.count })} className="rounded-full bg-sky-500/15 px-3 py-2 text-xs font-medium text-sky-200 hover:bg-sky-500/25">
                  {preset.label} · {preset.count}块
                </button>
              ))}
              <button type="button" onClick={() => dispatch({ type: 'clear' })} className="rounded-full bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10">清空</button>
            </div>

            {state.activePanel !== null && (
              <div className="mt-4 rounded-2xl border border-sky-400/25 bg-sky-500/10 p-3">
                <p className="text-xs font-semibold text-sky-200">正在编辑第 {state.activePanel + 1} 块板</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">在地图上按住并拖动；使用按钮在屋顶平面内旋转。</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => dispatch({ type: 'rotate', index: state.activePanel!, degrees: -15 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">↶ 15°</button>
                  <button type="button" onClick={() => dispatch({ type: 'rotate', index: state.activePanel!, degrees: 90 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">横/竖</button>
                  <button type="button" onClick={() => dispatch({ type: 'rotate', index: state.activePanel!, degrees: 15 })} className="rounded-lg bg-white/10 px-2 py-2 text-xs">15° ↷</button>
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="系统规模" value={`${summary.panelCount} 块`} detail={`${summary.capacityKw.toFixed(1)} kW`} />
              <Metric label="Google 年发电基准" value={`${Math.round(summary.annualAcKwh).toLocaleString()} kWh`} detail="自定义移动后仅作基准" />
              <Metric label="当前相对直射" value={`${Math.round(selectedLightAverage * 100)}%`} detail={sun?.daylight ? '按板面与太阳夹角' : '太阳位于地平线下'} />
              <Metric label="年减碳基准" value={`${Math.round(summary.annualCarbonKg).toLocaleString()} kg`} detail="基于当地电网" />
            </div>

            {state.overrides.size > 0 && (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                <span>{state.overrides.size} 块板已自定义移动</span>
                <button type="button" onClick={() => dispatch({ type: 'reset-custom' })} className="underline">恢复推荐位置</button>
              </div>
            )}

            <label className="mt-4 block text-xs text-slate-400" htmlFor="rate">电价假设（USD/kWh）</label>
            <input id="rate" type="number" min="0" step="0.001" value={electricityRate} onChange={(event) => setElectricityRate(Number(event.target.value) || 0)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400" />

            <button type="button" onClick={() => void copyShareLink()} className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold hover:bg-sky-400">复制分享链接</button>
            {shareMessage && <p className="mt-2 text-center text-xs text-emerald-300">{shareMessage}</p>}

            <div className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-5 text-slate-400">
              <p>{qualityLabel(state.insights.imageryQuality)} · 影像日期 {formatDate(state.insights)}</p>
              <p>Google 年发电量使用 0.85 DC→AC 折减；当前直射比例为几何模拟。</p>
            </div>
          </>
        )}

        {(state.status === 'no-data' || state.status === 'error') && (
          <div className="mt-4 flex flex-wrap gap-2">
            {DEMO_BUILDINGS.map((building) => (
              <button key={building.id} type="button" onClick={() => void analyzeLocation({ label: building.label, latitude: building.latitude, longitude: building.longitude })} className="rounded-lg bg-white/5 px-3 py-2 text-xs hover:bg-white/10">
                {building.borough}
              </button>
            ))}
          </div>
        )}
        <p className="mt-5 border-t border-white/10 pt-3 text-[11px] leading-5 text-slate-500">Source: Includes solar data from Google. 三维瓦片 © Google。</p>
      </aside>

      <section className="absolute bottom-4 left-4 right-4 z-30 rounded-2xl border border-white/10 bg-slate-950/94 px-4 py-3 shadow-2xl backdrop-blur-xl lg:left-6 lg:right-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-[230px] items-center gap-2">
            <input aria-label="模拟日期" type="date" value={dateIso} onChange={(event) => setDateIso(event.target.value)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm" />
            <button type="button" onClick={() => setPlaying((value) => !value)} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950">
              {playing ? '暂停' : '▶ 播放'}
            </button>
          </div>
          <div className="flex flex-1 items-center gap-3">
            <span className="w-12 text-right font-mono text-sm">{minuteLabel(minuteOfDay)}</span>
            <input aria-label="一天中的时间" type="range" min="0" max="1439" step="5" value={minuteOfDay} onChange={(event) => { setPlaying(false); setMinuteOfDay(Number(event.target.value)); }} className="h-2 flex-1 cursor-pointer accent-amber-400" />
          </div>
          <div className="grid min-w-[300px] grid-cols-3 gap-2 text-center text-xs">
            <SunMetric label="太阳方位" value={sun ? `${sun.azimuthDegrees.toFixed(1)}°` : '—'} />
            <SunMetric label="太阳高度" value={sun ? `${sun.altitudeDegrees.toFixed(1)}°` : '—'} />
            <SunMetric label="纽约时间" value={formatNewYorkTime(simulationDate)} />
          </div>
        </div>
      </section>
    </main>
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
