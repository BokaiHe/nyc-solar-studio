'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Map3DCanvas, type Map3DHandle, type MapLocation } from './map-3d-canvas';
import { PlaceSearch, type SelectedPlace } from './place-search';
import { calculateSolarSummary } from '@/lib/solar/calculations';
import {
  DEFAULT_ELECTRICITY_RATE_USD_PER_KWH,
  DEMO_BUILDINGS,
} from '@/lib/solar/config';
import {
  panelToPolygon,
  type PositioningMode,
} from '@/lib/solar/panel-to-polygon';
import {
  encodeSharedDesign,
  parseSharedDesign,
  selectedIndicesFromSharedDesign,
  type SharedDesign,
} from '@/lib/solar/share-state';
import type { BuildingInsights, CameraState, RenderPanel } from '@/lib/solar/types';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'no-data' | 'error';

type State = {
  status: LoadStatus;
  location: MapLocation | null;
  locationLabel: string;
  insights: BuildingInsights | null;
  panels: RenderPanel[];
  selected: Set<number>;
  baseCount: number;
  message: string;
};

type Action =
  | { type: 'loading'; location: MapLocation; label: string }
  | { type: 'loaded'; insights: BuildingInsights; panels: RenderPanel[]; selected?: Set<number>; baseCount?: number }
  | { type: 'no-data' }
  | { type: 'error'; message: string }
  | { type: 'toggle'; index: number }
  | { type: 'select-count'; count: number }
  | { type: 'clear' }
  | { type: 'replace-panels'; panels: RenderPanel[] };

const initialState: State = {
  status: 'idle',
  location: null,
  locationLabel: '',
  insights: null,
  panels: [],
  selected: new Set(),
  baseCount: 0,
  message: '搜索纽约地址，或先体验一栋演示住宅。',
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loading':
      return {
        ...initialState,
        status: 'loading',
        location: action.location,
        locationLabel: action.label,
        message: '正在读取屋顶光伏数据…',
      };
    case 'loaded':
      return {
        ...state,
        status: 'ready',
        insights: action.insights,
        panels: action.panels,
        selected: action.selected ?? new Set(),
        baseCount: action.baseCount ?? 0,
        message: '点击屋顶上的候选框添加光伏板。',
      };
    case 'no-data':
      return {
        ...state,
        status: 'no-data',
        insights: null,
        panels: [],
        selected: new Set(),
        message: '这栋建筑暂无可用的精细屋顶数据。',
      };
    case 'error':
      return { ...state, status: 'error', message: action.message };
    case 'toggle': {
      const selected = new Set(state.selected);
      if (selected.has(action.index)) selected.delete(action.index);
      else selected.add(action.index);
      return { ...state, selected };
    }
    case 'select-count':
      return {
        ...state,
        selected: new Set(Array.from({ length: action.count }, (_, index) => index)),
        baseCount: action.count,
      };
    case 'clear':
      return { ...state, selected: new Set(), baseCount: 0 };
    case 'replace-panels':
      return { ...state, panels: action.panels };
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

export function SolarApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [positioningMode, setPositioningMode] =
    useState<PositioningMode>('RELATIVE_TO_MESH');
  const [electricityRate, setElectricityRate] = useState(
    DEFAULT_ELECTRICITY_RATE_USD_PER_KWH,
  );
  const [shareMessage, setShareMessage] = useState('');
  const [dataWarning, setDataWarning] = useState('');
  const mapRef = useRef<Map3DHandle>(null);
  const didLoadSharedRef = useRef(false);
  const searchParams = useSearchParams();
  const sharedDesign = useMemo(
    () => parseSharedDesign(searchParams.toString()),
    [searchParams],
  );
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

  const makeRenderPanels = useCallback(
    (insights: BuildingInsights, mode: PositioningMode) =>
      insights.solarPotential.solarPanels.map((panel, index) =>
        panelToPolygon(
          panel,
          insights.solarPotential.roofSegmentStats[panel.segmentIndex],
          {
            widthM: insights.solarPotential.panelWidthMeters,
            heightM: insights.solarPotential.panelHeightMeters,
          },
          mode,
          index,
        ),
      ),
    [],
  );

  const analyzeLocation = useCallback(
    async (place: SelectedPlace, shared?: SharedDesign) => {
      const location = { latitude: place.latitude, longitude: place.longitude };
      dispatch({ type: 'loading', location, label: place.label });
      setDataWarning('');
      setShareMessage('');

      try {
        const response = await fetch(
          `/api/solar?lat=${place.latitude}&lng=${place.longitude}`,
        );
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

        const panels = makeRenderPanels(insights, positioningMode);
        let selected = new Set<number>();
        let baseCount = 0;
        if (shared) {
          selected = selectedIndicesFromSharedDesign(shared);
          baseCount = shared.baseCount;
          if (
            dateKey(insights) !==
              `${shared.imageryDate.year}${String(shared.imageryDate.month).padStart(2, '0')}${String(shared.imageryDate.day).padStart(2, '0')}` ||
            insights.solarPotential.solarPanels.length !== shared.panelCount
          ) {
            setDataWarning('Google 屋顶数据已更新，当前布局可能与分享时不同。');
          }
        }

        dispatch({ type: 'loaded', insights, panels, selected, baseCount });
      } catch {
        dispatch({ type: 'error', message: 'Solar 服务暂时不可用，请稍后重试。' });
      }
    },
    [makeRenderPanels, positioningMode],
  );

  useEffect(() => {
    if (didLoadSharedRef.current) return;
    didLoadSharedRef.current = true;
    const shared = sharedDesign;
    if (!shared) return;
    const frame = requestAnimationFrame(() => {
      void analyzeLocation(
        {
          label: '分享的纽约屋顶方案',
          latitude: shared.latitude,
          longitude: shared.longitude,
        },
        shared,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [analyzeLocation, sharedDesign]);

  useEffect(() => {
    if (!state.insights) return;
    dispatch({
      type: 'replace-panels',
      panels: makeRenderPanels(state.insights, positioningMode),
    });
  }, [makeRenderPanels, positioningMode, state.insights]);

  const summary = useMemo(
    () =>
      state.insights
        ? calculateSolarSummary(
            state.insights.solarPotential,
            state.selected,
            electricityRate,
          )
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
      { label: '帮我铺满', count: configs[indices[2]].panelsCount },
    ].filter((item, index, items) => items.findIndex((x) => x.count === item.count) === index);
  }, [state.insights]);

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
      camera: mapRef.current?.getCamera() ?? { heading: 25, tilt: 67, range: 260 },
    });
    const url = `${window.location.origin}${path}`;
    await navigator.clipboard.writeText(url);
    setShareMessage('链接已复制');
  }, [state]);

  const initialCamera: CameraState | undefined = sharedDesign?.camera;

  if (!apiKey) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <section className="max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-8">
          <p className="text-sm font-semibold text-amber-300">需要配置 API Key</p>
          <h1 className="mt-2 text-2xl font-semibold">NYC Solar Roof 3D</h1>
          <p className="mt-4 leading-7 text-slate-300">
            请复制 <code>.env.example</code> 为 <code>.env.local</code>，填写浏览器地图 Key 和服务端 Solar Key。
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="relative h-screen min-h-[680px] overflow-hidden bg-slate-950 text-white">
      <Map3DCanvas
        ref={mapRef}
        apiKey={apiKey}
        location={state.location}
        panels={state.panels}
        selectedIndices={state.selected}
        positioningMode={positioningMode}
        initialCamera={initialCamera}
        onTogglePanel={(index) => dispatch({ type: 'toggle', index })}
        onMapError={() => dispatch({ type: 'error', message: '三维地图加载失败。' })}
      />

      <header className="absolute left-4 right-4 top-4 z-20 flex flex-col gap-3 lg:left-6 lg:right-auto lg:w-[420px]">
        <div className="rounded-2xl border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-sky-300">NYC Solar Roof</p>
              <h1 className="mt-1 text-xl font-semibold">在真实屋顶上规划太阳能板</h1>
            </div>
            <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-300">Demo</span>
          </div>
          <div className="mt-4">
            <PlaceSearch
              apiKey={apiKey}
              disabled={state.status === 'loading'}
              onSelect={(place) => void analyzeLocation(place)}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {DEMO_BUILDINGS.map((building) => (
              <button
                key={building.id}
                type="button"
                disabled={state.status === 'loading'}
                onClick={() =>
                  void analyzeLocation({
                    label: building.label,
                    latitude: building.latitude,
                    longitude: building.longitude,
                  })
                }
                className="rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-xs text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
              >
                {building.borough}
              </button>
            ))}
          </div>
        </div>
      </header>

      <aside className="absolute bottom-4 right-4 z-20 max-h-[calc(100vh-2rem)] w-[min(390px,calc(100vw-2rem))] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/92 p-5 shadow-2xl backdrop-blur-xl lg:bottom-auto lg:right-6 lg:top-6">
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
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => dispatch({ type: 'select-count', count: preset.count })}
                  className="rounded-full bg-sky-500/15 px-3 py-2 text-xs font-medium text-sky-200 hover:bg-sky-500/25"
                >
                  {preset.label} · {preset.count}块
                </button>
              ))}
              <button
                type="button"
                onClick={() => dispatch({ type: 'clear' })}
                className="rounded-full bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10"
              >
                清空
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="系统规模" value={`${summary.panelCount} 块`} detail={`${summary.capacityKw.toFixed(1)} kW`} />
              <Metric label="预计年发电量" value={`${Math.round(summary.annualAcKwh).toLocaleString()} kWh`} detail="交流侧估算" />
              <Metric label="年度电力价值" value={`$${Math.round(summary.annualElectricityValueUsd).toLocaleString()}`} detail={`按 $${electricityRate.toFixed(3)}/kWh`} />
              <Metric label="年减碳" value={`${Math.round(summary.annualCarbonKg).toLocaleString()} kg`} detail="基于当地电网" />
            </div>

            <p className="mt-3 rounded-xl bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
              相当于纽约家庭常用冰箱约 {summary.refrigeratorYearsEquivalent.toFixed(1)} 年的用电量。
            </p>

            <label className="mt-4 block text-xs text-slate-400" htmlFor="rate">电价假设（USD/kWh）</label>
            <input
              id="rate"
              type="number"
              min="0"
              step="0.001"
              value={electricityRate}
              onChange={(event) => setElectricityRate(Number(event.target.value) || 0)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-sky-400"
            />

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void copyShareLink()}
                className="flex-1 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold hover:bg-sky-400"
              >
                复制分享链接
              </button>
              <select
                aria-label="屋顶定位模式"
                value={positioningMode}
                onChange={(event) => setPositioningMode(event.target.value as PositioningMode)}
                className="rounded-xl border border-white/10 bg-slate-900 px-3 py-3 text-xs"
              >
                <option value="RELATIVE_TO_MESH">Mesh</option>
                <option value="ABSOLUTE">Absolute</option>
              </select>
            </div>
            {shareMessage && <p className="mt-2 text-center text-xs text-emerald-300">{shareMessage}</p>}

            <div className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-5 text-slate-400">
              <p>{qualityLabel(state.insights.imageryQuality)} · 影像日期 {formatDate(state.insights)}</p>
              <p>年发电量由 Google Solar API 估算，DC→AC 使用 0.85 折减。</p>
              <p>冰箱等效采用 EIA 2020 RECS 纽约州常用冰箱 542 kWh/年。</p>
            </div>
          </>
        )}

        {(state.status === 'no-data' || state.status === 'error') && (
          <div className="mt-4">
            <p className="text-sm leading-6 text-slate-400">可以尝试下方经过预设的演示入口：</p>
            <div className="mt-2 flex gap-2">
              {DEMO_BUILDINGS.map((building) => (
                <button
                  key={building.id}
                  type="button"
                  onClick={() => void analyzeLocation({ label: building.label, latitude: building.latitude, longitude: building.longitude })}
                  className="rounded-lg bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
                >
                  {building.borough}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-5 border-t border-white/10 pt-3 text-[11px] leading-5 text-slate-500">
          Source: Includes solar data from Google. 结果用于早期可行性探索。
        </p>
      </aside>
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
