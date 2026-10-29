'use client';

import { useState, type Dispatch } from 'react';
import { useI18n } from '@/lib/i18n';
import type { LayoutResult } from '@/lib/design/auto-layout';
import { isUntouchedLayout, sameParams, type LayoutParams, type StudioAction, type StudioState } from '@/lib/design/state';
import { Eyebrow, NumberField, primaryButtonClass, secondaryButtonClass, SidePanel, Toggle } from './ui';

export function DesignPanel({ state, capacityKw, dispatch, onGenerate, layoutBusy, layoutResult, onNext }: {
  state: StudioState;
  capacityKw: number;
  dispatch: Dispatch<StudioAction>;
  onGenerate: () => void;
  layoutBusy: boolean;
  layoutResult: Omit<LayoutResult, 'panels'> | null;
  onNext: () => void;
}) {
  const { t } = useI18n();
  // Phones start collapsed so the roof stays visible. The panel only mounts
  // client-side after a building loads, so reading the viewport here is safe.
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const [moreOpen, setMoreOpen] = useState(false);
  const { panels, params, generated } = state;
  const untouched = isUntouchedLayout(state);
  // Hand edits pause live updates; offer to apply changed settings instead.
  const settingsPending = !untouched && generated !== null && !sameParams(generated.params, params);
  const setNumber = (key: keyof Pick<LayoutParams, 'azimuthDegrees' | 'tiltDegrees' | 'setbackMeters' | 'rowSpacingMeters' | 'maxPanels'>) =>
    (value: number) => dispatch({ type: 'set-params', params: { [key]: value } });

  return (
    <SidePanel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>{t.design.eyebrow}</Eyebrow>
          <h2 className="mt-1 text-lg font-semibold">
            {t.design.count(panels.length)}
            <span className="ml-2 text-sm font-medium text-slate-500">{t.design.capacity(capacityKw.toFixed(1))}</span>
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t.design.expand : t.design.collapse}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </div>

      {!collapsed && (
        <>
          {state.notice && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{t.design[state.notice]}</p>}

          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className={`h-2 w-2 shrink-0 rounded-full ${untouched ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            <span className="text-slate-600">{layoutBusy ? t.design.generating : untouched ? t.design.statusAuto : t.design.statusEdited}</span>
          </div>
          {layoutResult && untouched && !layoutBusy && (
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              {layoutResult.candidateCount ? t.design.layoutSummary(panels.length, layoutResult.shadedCount) : t.design.layoutEmpty}
            </p>
          )}

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t.design.layoutTitle}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            <NumberField label={t.design.azimuth} value={params.azimuthDegrees} min={0} max={359} onChange={setNumber('azimuthDegrees')} />
            <NumberField label={t.design.tilt} value={params.tiltDegrees} min={0} max={45} onChange={setNumber('tiltDegrees')} />
            <NumberField label={t.design.setback} value={params.setbackMeters} min={0} max={5} step={0.1} onChange={setNumber('setbackMeters')} />
            <NumberField label={t.design.rowSpacing} value={params.rowSpacingMeters} min={0} max={5} step={0.1} onChange={setNumber('rowSpacingMeters')} />
          </div>

          <button type="button" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} className="mt-3 text-xs font-medium text-sky-700 hover:underline">
            {moreOpen ? '▾' : '▸'} {t.design.moreOptions}
          </button>
          {moreOpen && (
            <div className="mt-2 space-y-2">
              <NumberField label={t.design.maxPanels} value={params.maxPanels} min={0} max={5000} onChange={setNumber('maxPanels')} />
              <Toggle label={t.design.alignToRoof} checked={params.alignToRoof} onChange={(alignToRoof) => dispatch({ type: 'set-params', params: { alignToRoof } })} />
              <Toggle label={t.design.includeShaded} checked={params.includeShaded} onChange={(includeShaded) => dispatch({ type: 'set-params', params: { includeShaded } })} />
              <p className="text-[11px] leading-5 text-slate-500">{t.design.flatRoofNote}</p>
            </div>
          )}

          {settingsPending ? (
            <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-3">
              <button type="button" disabled={layoutBusy} onClick={onGenerate} className={primaryButtonClass}>{t.design.applySettings}</button>
              <p className="mt-2 text-[11px] leading-5 text-sky-900">{t.design.applyHint}</p>
            </div>
          ) : !untouched && (
            <button type="button" disabled={layoutBusy} onClick={onGenerate} className={`${secondaryButtonClass} mt-4 w-full py-2.5`}>
              {generated ? t.design.regenerate : t.design.generate}
            </button>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })} className={secondaryButtonClass} title="Ctrl+Z">↶ {t.design.undo}</button>
            <button type="button" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })} className={secondaryButtonClass} title="Ctrl+Shift+Z">{t.design.redo} ↷</button>
            <button type="button" disabled={!panels.length} onClick={() => dispatch({ type: 'clear-panels' })} className={secondaryButtonClass}>{t.design.clear}</button>
          </div>
        </>
      )}

      <button type="button" disabled={!panels.length} onClick={onNext} className={`${primaryButtonClass} mt-4`}>{t.design.next} →</button>
    </SidePanel>
  );
}
