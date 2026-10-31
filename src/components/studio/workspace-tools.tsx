'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import type { ConceptPanel } from '@/lib/solar/types';
import { YIELD_COLORS, type Comparisons } from '@/lib/design/workspace';
import { secondaryButtonClass } from './ui';

export type ComparisonMetrics = { count: number; capacity: number; annual: number; specific: number };
type Slot = 'A' | 'B';
const SLOTS: Slot[] = ['A', 'B'];

const formatKwh = (value: number) => Math.round(value).toLocaleString();

// Yield heatmap, the selected panel's annual figures, A/B slots and the
// browser draft status, shared by the design and results panels.
export function WorkspaceTools({ heatmap, onHeatmap, selected, selectedKwh, busy, saveStatus, comparisons, metrics, onSave, onApply }: {
  heatmap: boolean;
  onHeatmap: () => void;
  selected?: ConceptPanel;
  // Annual AC energy of the selected panel; undefined while energy catches up.
  selectedKwh?: number;
  busy: boolean;
  saveStatus: 'idle' | 'saved' | 'error';
  comparisons: Comparisons;
  metrics: Record<Slot, ComparisonMetrics | null>;
  onSave: (slot: Slot) => void;
  onApply: (slot: Slot) => void;
}) {
  const { t } = useI18n();
  const w = t.workspace;
  const row = (label: string, value: (metrics: ComparisonMetrics) => ReactNode) => (
    <tr key={label}>
      <th className="py-1 text-left font-normal">{label}</th>
      {SLOTS.map((slot) => {
        const slotMetrics = metrics[slot];
        return <td key={slot} className="text-right tabular-nums">{slotMetrics ? value(slotMetrics) : '—'}</td>;
      })}
    </tr>
  );
  const { A, B } = metrics;

  return (
    <section className="mt-4 space-y-3 border-t border-separator pt-3" aria-label={w.label}>
      <button type="button" aria-pressed={heatmap} onClick={onHeatmap} className={`${secondaryButtonClass} w-full`}>
        {heatmap ? w.heatmapOn : w.heatmapShow}
      </button>
      {heatmap && (
        <div className="text-[11px] leading-4 text-label-secondary">
          <div className="flex h-2 overflow-hidden rounded-full">
            {YIELD_COLORS.map((color) => <span key={color} className="flex-1" style={{ background: color }} />)}
          </div>
          <div className="mt-1 flex justify-between">{w.heatmapLegend.map((label) => <span key={label}>{label}</span>)}</div>
          <p className="mt-1">{w.heatmapNote}</p>
          <p>{w.heatmapSelected}</p>
        </div>
      )}
      {selected && (
        <div className="rounded-xl bg-fill p-2 text-[12px]" data-testid="panel-yield-detail">
          <p className="font-semibold">
            {w.panel(selected.id)} · {busy || selectedKwh === undefined ? '…' : w.panelKwh(formatKwh(selectedKwh))}
          </p>
          <p>{w.panelPose(selected.tiltDegrees.toFixed(1), selected.azimuthDegrees.toFixed(1))}</p>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-[13px] font-semibold">{w.compareTitle}</summary>
        <p className="mt-2 text-[11px] text-label-secondary">{w.compareNote}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {SLOTS.map((slot) => (
            <div key={slot} className="space-y-1 rounded-xl bg-fill/50 p-2">
              <button type="button" disabled={busy} onClick={() => onSave(slot)} className={`${secondaryButtonClass} w-full`}>{w.save(slot)}</button>
              <button type="button" disabled={!comparisons[slot] || busy} onClick={() => onApply(slot)} className={`${secondaryButtonClass} w-full`}>{w.apply(slot)}</button>
            </div>
          ))}
        </div>
        <table className="mt-2 w-full text-[11px]" aria-label={w.metricsLabel}>
          <thead><tr><th /><th className="text-right">A</th><th className="text-right">B</th></tr></thead>
          <tbody>
            {row(w.modules, (m) => m.count)}
            {row(w.capacity, (m) => m.capacity.toFixed(1))}
            {row(w.annual, (m) => formatKwh(m.annual))}
            {row(w.specific, (m) => formatKwh(m.specific))}
          </tbody>
        </table>
        {A && B && (
          <p className="mt-2 text-[12px] font-medium" data-testid="comparison-delta">
            {w.delta(
              `${B.annual >= A.annual ? '+' : ''}${formatKwh(B.annual - A.annual)}`,
              A.annual > 0 ? `${((B.annual / A.annual - 1) * 100).toFixed(1)}%` : '',
            )}
          </p>
        )}
      </details>
      <p role="status" className={`text-[11px] ${saveStatus === 'error' ? 'text-destructive' : 'text-label-secondary'}`}>
        {saveStatus === 'error' ? w.saveFailed : saveStatus === 'saved' ? w.saved : w.autosave}
      </p>
    </section>
  );
}
