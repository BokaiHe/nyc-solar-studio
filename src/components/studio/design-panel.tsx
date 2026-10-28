'use client';

import type { Dispatch } from 'react';
import { useI18n } from '@/lib/i18n';
import type { LayoutResult } from '@/lib/design/auto-layout';
import type { StudioAction, StudioState } from '@/lib/design/state';
import { Eyebrow, NumberField, primaryButtonClass, secondaryButtonClass, SidePanel, Toggle } from './ui';

export function DesignPanel({ state, capacityKw, dispatch, onAutoLayout, layoutBusy, layoutResult, onNext }: {
  state: StudioState;
  capacityKw: number;
  dispatch: Dispatch<StudioAction>;
  onAutoLayout: () => void;
  layoutBusy: boolean;
  layoutResult: Omit<LayoutResult, 'panels'> | null;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const { panels, params, selectedId } = state;
  const selected = panels.find((panel) => panel.id === selectedId);
  const setParam = (key: 'azimuthDegrees' | 'tiltDegrees' | 'setbackMeters' | 'rowSpacingMeters' | 'maxPanels') => (value: number) => dispatch({ type: 'set-params', params: { [key]: value } });

  return (
    <SidePanel>
      <Eyebrow>{t.design.eyebrow}</Eyebrow>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{t.design.count(panels.length)}</h2>
        <span className="text-sm font-medium text-slate-500">{t.design.capacity(capacityKw.toFixed(1))}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{t.design.intro}</p>
      {state.notice && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{t.design[state.notice]}</p>}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button type="button" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })} className={secondaryButtonClass} title="Ctrl+Z">{t.design.undo}</button>
        <button type="button" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })} className={secondaryButtonClass} title="Ctrl+Shift+Z">{t.design.redo}</button>
        <button type="button" disabled={!panels.length} onClick={() => dispatch({ type: 'set-panels', panels: [] })} className={secondaryButtonClass}>{t.design.clear}</button>
      </div>

      {selected && (
        <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50 p-3">
          <p className="text-xs font-semibold text-sky-900">{t.design.panelInfo(selected.id, Math.round(selected.azimuthDegrees))}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button type="button" aria-label={t.design.rotateLeft} onClick={() => dispatch({ type: 'update-panel', id: selected.id, patch: { azimuthDegrees: (selected.azimuthDegrees + 355) % 360 } })} className={secondaryButtonClass}>↶ 5°</button>
            <button type="button" onClick={() => dispatch({ type: 'update-panel', id: selected.id, patch: { landscape: !selected.landscape } })} className={secondaryButtonClass}>{t.design.portraitLandscape}</button>
            <button type="button" aria-label={t.design.rotateRight} onClick={() => dispatch({ type: 'update-panel', id: selected.id, patch: { azimuthDegrees: (selected.azimuthDegrees + 5) % 360 } })} className={secondaryButtonClass}>5° ↷</button>
          </div>
          <button type="button" onClick={() => dispatch({ type: 'remove-panel', id: selected.id })} className="mt-2 w-full rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100" title="Delete">{t.design.delete}</button>
        </div>
      )}

      <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t.design.layoutTitle}</p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <NumberField label={t.design.azimuth} value={params.azimuthDegrees} min={0} max={359} onChange={setParam('azimuthDegrees')} />
        <NumberField label={t.design.tilt} value={params.tiltDegrees} min={0} max={45} onChange={setParam('tiltDegrees')} />
        <NumberField label={t.design.setback} value={params.setbackMeters} min={0} max={5} step={0.1} onChange={setParam('setbackMeters')} />
        <NumberField label={t.design.rowSpacing} value={params.rowSpacingMeters} min={0} max={5} step={0.1} onChange={setParam('rowSpacingMeters')} />
        <NumberField label={t.design.maxPanels} value={params.maxPanels} min={0} max={5000} step={1} onChange={setParam('maxPanels')} />
      </div>
      <div className="mt-3 space-y-2">
        <Toggle label={t.design.alignToRoof} checked={params.alignToRoof} onChange={(alignToRoof) => dispatch({ type: 'set-params', params: { alignToRoof } })} />
        <Toggle label={t.design.includeShaded} checked={params.includeShaded} onChange={(includeShaded) => dispatch({ type: 'set-params', params: { includeShaded } })} />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-slate-500">{t.design.flatRoofNote}</p>
      <button type="button" disabled={layoutBusy} onClick={onAutoLayout} className={`${primaryButtonClass} mt-3`}>{layoutBusy ? t.design.generating : t.design.autoLayout}</button>
      {layoutResult && !layoutBusy && (
        <p className="mt-2 text-xs leading-5 text-slate-600">
          {layoutResult.candidateCount ? t.design.layoutSummary(layoutResult.candidateCount - layoutResult.shadedCount, layoutResult.shadedCount) : t.design.layoutEmpty}
        </p>
      )}
      <button type="button" disabled={!panels.length} onClick={onNext} className={`${secondaryButtonClass} mt-2 w-full py-3 font-semibold`}>{t.design.next} →</button>
    </SidePanel>
  );
}
