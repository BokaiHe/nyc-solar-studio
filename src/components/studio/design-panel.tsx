'use client';

import { useState, type Dispatch, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import type { LayoutResult } from '@/lib/design/auto-layout';
import { zoneArea } from '@/lib/design/keep-out';
import { isUntouchedLayout, sameParams, type LayoutParams, type StudioAction, type StudioState } from '@/lib/design/state';
import { Eyebrow, GroupTitle, PanelTitle, primaryButtonClass, secondaryButtonClass, SidePanel, SliderField, Switch } from './ui';

export function DesignPanel({ state, capacityKw, dispatch, onGenerate, onHighlightZone, onDetectZones, detect, layoutBusy, neighborStatus, neighborCount, layoutResult, onNext, optimizer, workspace }: {
  state: StudioState;
  capacityKw: number;
  dispatch: Dispatch<StudioAction>;
  onGenerate: () => void;
  // Outlines a keep-out area in the scene while its row is hovered.
  onHighlightZone: (id: number | null) => void;
  // Finds keep-out areas in the aerial imagery; null until the imagery loads.
  onDetectZones: (() => void) | null;
  detect: { status: 'idle' | 'running' | 'done'; count: number; model: boolean };
  layoutBusy: boolean;
  neighborStatus: 'idle' | 'loading' | 'ready' | 'error';
  neighborCount: number;
  layoutResult: Omit<LayoutResult, 'panels'> | null;
  onNext: () => void;
  // The best-layout search card, rendered under the layout status.
  optimizer: ReactNode;
  workspace?: ReactNode;
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
            <span className="text-label-secondary">
              {layoutBusy ? t.design.generating : untouched ? t.design.statusAuto : state.pristine ? t.design.statusEmpty : t.design.statusEdited}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-label-secondary">
            <span className={`h-2 w-2 shrink-0 rounded-full ${neighborStatus === 'ready' ? 'bg-accent' : neighborStatus === 'error' ? 'bg-warning' : 'animate-pulse bg-label-tertiary'}`} />
            <span>
              {neighborStatus === 'ready'
                ? (neighborCount ? t.design.neighborsReady(neighborCount) : t.design.neighborsNone)
                : neighborStatus === 'error' ? t.design.neighborsFailed : t.design.neighborsLoading}
            </span>
          </div>
          {layoutResult && untouched && !layoutBusy && (
            <p className="mt-1 text-[12px] leading-5 text-label-secondary">
              {layoutResult.candidateCount ? t.design.layoutSummary(panels.length, layoutResult.shadedCount) : t.design.layoutEmpty}
            </p>
          )}

          {state.pristine && (
            // A new roof starts empty: outline what must stay clear, then generate.
            <div className="mt-4 rounded-[14px] bg-accent/8 p-3">
              <p className="text-[15px] font-semibold">{t.design.emptyTitle}</p>
              <p className="mt-1 text-[13px] leading-5 text-label-secondary">{t.design.emptyBody}</p>
              <button type="button" disabled={!onDetectZones || detect.status === 'running'} onClick={() => onDetectZones?.()} className={`${secondaryButtonClass} mt-3 w-full py-2.5`}>
                {detect.status === 'running' ? t.design.detecting : t.design.detectZonesLong}
              </button>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => dispatch({ type: 'set-tool', tool: 'zone' })} className={`${secondaryButtonClass} py-2.5`}>
                  ⬠ {t.design.drawZones}
                </button>
                <button type="button" disabled={layoutBusy} onClick={onGenerate} className={`${primaryButtonClass} !py-2`}>{t.design.generate}</button>
              </div>
            </div>
          )}

          {workspace}
          {optimizer}

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

          <div data-tour="zones" className="mt-4 rounded-[14px] bg-fill/60 p-3 text-[12px] leading-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{t.design.zones(params.keepOut.length)}</span>
              <span className="flex items-center gap-3">
                <button type="button" disabled={!onDetectZones || detect.status === 'running'} title={onDetectZones ? undefined : t.design.detectUnavailable} onClick={() => onDetectZones?.()} className="text-[13px] font-medium text-accent disabled:text-label-tertiary">
                  {detect.status === 'running' ? t.design.detecting : t.design.detectZones}
                </button>
                {params.keepOut.length > 0 && (
                  <button type="button" onClick={() => dispatch({ type: 'set-params', params: { keepOut: [] } })} className="text-[13px] font-medium text-destructive">
                    {t.design.clearZones}
                  </button>
                )}
              </span>
            </div>
            {detect.status === 'done' && <p className="mt-1 text-[12px] leading-5 text-accent">{t.design.detectFound(detect.count, detect.model)}</p>}
            {params.keepOut.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {params.keepOut.map((zone, index) => (
                  <li
                    key={zone.id}
                    onMouseEnter={() => onHighlightZone(zone.id)}
                    onMouseLeave={() => onHighlightZone(null)}
                    className="flex items-center justify-between gap-2 rounded-[9px] bg-white/70 py-1 pl-2.5 pr-1 text-[13px]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
                      {t.design.zoneName(index + 1)}
                      {zone.auto && <span className="rounded-[5px] bg-accent/12 px-1.5 text-[11px] font-medium text-accent">{t.design.autoTag}</span>}
                      <span className="tabular-nums text-label-secondary">{t.design.zoneArea(zoneArea(zone).toFixed(1))}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={t.design.removeZone(index + 1)}
                      title={t.design.removeZone(index + 1)}
                      onClick={() => {
                        onHighlightZone(null);
                        dispatch({ type: 'remove-zone', id: zone.id });
                      }}
                      className="grid h-7 w-7 place-items-center rounded-full text-[15px] text-label-secondary transition hover:bg-destructive/10 hover:text-destructive active:scale-95"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-label-secondary">{t.design.zonesHint}</p>
          </div>

          {settingsPending ? (
            <div className="mt-4 rounded-[14px] bg-accent/8 p-3">
              <button type="button" disabled={layoutBusy} onClick={onGenerate} className={primaryButtonClass}>{t.design.applySettings}</button>
              <p className="mt-2 text-[12px] leading-5 text-label-secondary">{t.design.applyHint}</p>
            </div>
          ) : !untouched && !state.pristine && (
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
