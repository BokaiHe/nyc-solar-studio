'use client';

import { useState, type Dispatch } from 'react';
import { useI18n } from '@/lib/i18n';
import type { LayoutResult } from '@/lib/design/auto-layout';
import { isUntouchedLayout, sameParams, type LayoutParams, type StudioAction, type StudioState } from '@/lib/design/state';
import { Eyebrow, GroupTitle, PanelTitle, primaryButtonClass, secondaryButtonClass, SidePanel, SliderField, Switch } from './ui';

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
  const set = (key: keyof Pick<LayoutParams, 'azimuthDegrees' | 'tiltDegrees' | 'setbackMeters' | 'rowSpacingMeters' | 'maxPanels'>) =>
    (value: number) => dispatch({ type: 'set-params', params: { [key]: value } });
  const compass = (degrees: number) => t.design.compass[Math.round(degrees / 45) % 8];
  // The limit slider spans the positions that fit on this roof.
  const limitMax = Math.max(20, layoutResult?.candidateCount ?? panels.length, params.maxPanels);

  return (
    <SidePanel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>{t.design.eyebrow}</Eyebrow>
          <div className="mt-0.5 flex items-baseline gap-2">
            <PanelTitle>{t.design.count(panels.length)}</PanelTitle>
            <span className="text-[15px] tabular-nums text-label-secondary">{t.design.capacity(capacityKw.toFixed(1))}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t.design.expand : t.design.collapse}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fill text-[11px] text-label-secondary transition hover:bg-fill-strong active:scale-95"
        >
          {collapsed ? '▲' : '▼'}
        </button>
      </div>

      {!collapsed && (
        <>
          {state.notice && <p className="mt-3 rounded-[12px] bg-warning/12 px-3 py-2 text-[13px] text-[#9a5b00]">{t.design[state.notice]}</p>}

          <div className="mt-3 flex items-center gap-2 text-[13px]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${untouched ? 'bg-success' : 'bg-label-tertiary'}`} />
            <span className="text-label-secondary">{layoutBusy ? t.design.generating : untouched ? t.design.statusAuto : t.design.statusEdited}</span>
          </div>
          {layoutResult && untouched && !layoutBusy && (
            <p className="mt-1 text-[12px] leading-5 text-label-secondary">
              {layoutResult.candidateCount ? t.design.layoutSummary(panels.length, layoutResult.shadedCount) : t.design.layoutEmpty}
            </p>
          )}

          <div className="mt-5"><GroupTitle>{t.design.layoutTitle}</GroupTitle></div>
          <div className="mt-2 space-y-3 rounded-[14px] bg-fill/60 p-3">
            <SliderField label={t.design.azimuth} value={params.azimuthDegrees} min={0} max={359} format={(value) => `${value}° ${compass(value)}`} onChange={set('azimuthDegrees')} />
            <SliderField label={t.design.tilt} value={params.tiltDegrees} min={0} max={45} unit="°" onChange={set('tiltDegrees')} />
            <SliderField label={t.design.setback} value={params.setbackMeters} min={0} max={5} step={0.1} format={(value) => `${value.toFixed(1)} m`} onChange={set('setbackMeters')} />
            <SliderField label={t.design.rowSpacing} value={params.rowSpacingMeters} min={0} max={5} step={0.1} format={(value) => `${value.toFixed(1)} m`} onChange={set('rowSpacingMeters')} />
          </div>

          <button type="button" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} className="mt-3 flex items-center gap-1 text-[13px] font-medium text-accent">
            <span className={`inline-block transition-transform ${moreOpen ? 'rotate-90' : ''}`}>›</span> {t.design.moreOptions}
          </button>
          {moreOpen && (
            <div className="mt-2 space-y-3 rounded-[14px] bg-fill/60 p-3">
              <SliderField label={t.design.maxPanels} value={params.maxPanels} min={0} max={limitMax} format={(value) => (value === 0 ? t.design.fill : String(value))} onChange={set('maxPanels')} />
              <div className="h-px bg-separator" />
              <Switch label={t.design.alignToRoof} checked={params.alignToRoof} onChange={(alignToRoof) => dispatch({ type: 'set-params', params: { alignToRoof } })} />
              <div className="h-px bg-separator" />
              <Switch label={t.design.includeShaded} checked={params.includeShaded} onChange={(includeShaded) => dispatch({ type: 'set-params', params: { includeShaded } })} />
              <p className="text-[12px] leading-5 text-label-secondary">{t.design.flatRoofNote}</p>
            </div>
          )}

          {settingsPending ? (
            <div className="mt-4 rounded-[14px] bg-accent/8 p-3">
              <button type="button" disabled={layoutBusy} onClick={onGenerate} className={primaryButtonClass}>{t.design.applySettings}</button>
              <p className="mt-2 text-[12px] leading-5 text-label-secondary">{t.design.applyHint}</p>
            </div>
          ) : !untouched && (
            <button type="button" disabled={layoutBusy} onClick={onGenerate} className={`${secondaryButtonClass} mt-4 w-full py-2.5`}>
              {generated ? t.design.regenerate : t.design.generate}
            </button>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })} className={secondaryButtonClass} title="Ctrl+Z">{t.design.undo}</button>
            <button type="button" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })} className={secondaryButtonClass} title="Ctrl+Shift+Z">{t.design.redo}</button>
            <button type="button" disabled={!panels.length} onClick={() => dispatch({ type: 'clear-panels' })} className={`${secondaryButtonClass} text-destructive`}>{t.design.clear}</button>
          </div>
        </>
      )}

      <button type="button" disabled={!panels.length} onClick={onNext} className={`${primaryButtonClass} mt-4`}>{t.design.next}</button>
    </SidePanel>
  );
}
