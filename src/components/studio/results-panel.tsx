'use client';

import { useI18n } from '@/lib/i18n';
import type { DesignSummary } from '@/lib/solar/calculations';
import { Eyebrow, Metric, primaryButtonClass, secondaryButtonClass, SidePanel } from './ui';

export function ResultsPanel({ summary, hasGoogleData, rate, onRateChange, onShare, copied, onBack }: {
  summary: DesignSummary;
  hasGoogleData: boolean;
  rate: number;
  onRateChange: (rate: number) => void;
  onShare: () => void;
  copied: boolean;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const formatNumber = (value: number | null, unit: string) =>
    value === null ? t.results.unavailable : `${Math.round(value).toLocaleString()} ${unit}`;

  return (
    <SidePanel>
      <Eyebrow>{t.results.eyebrow}</Eyebrow>
      <h2 className="mt-1 text-lg font-semibold">{t.results.title(summary.capacityKw.toFixed(1))}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric label={t.results.panels} value={t.results.panelCount(summary.panelCount)} detail={t.results.layout} />
        <Metric label={t.results.energy} value={formatNumber(summary.annualAcKwh, 'kWh')} detail={t.results.energyDetail} />
        <Metric label={t.results.carbon} value={formatNumber(summary.annualCarbonKg, 'kg')} detail={t.results.carbonDetail} />
        <Metric label={t.results.savings} value={summary.annualElectricityValueUsd === null ? t.results.unavailable : `$${Math.round(summary.annualElectricityValueUsd).toLocaleString()}`} detail={t.results.savingsDetail} />
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">{hasGoogleData ? t.results.note : t.results.noGoogle}</p>

      <label className="mt-4 block text-xs text-slate-500" htmlFor="rate">{t.results.rate}</label>
      <input
        id="rate"
        type="number"
        min="0"
        step="0.001"
        value={rate}
        onChange={(event) => onRateChange(Math.max(0, Number(event.target.value) || 0))}
        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500"
      />

      <button type="button" onClick={onShare} className={`${primaryButtonClass} mt-4`}>{t.results.share}</button>
      {copied && <p className="mt-2 text-center text-xs text-emerald-700">{t.results.copied}</p>}
      <button type="button" onClick={onBack} className={`${secondaryButtonClass} mt-2 w-full py-3`}>← {t.results.back}</button>
      <p className="mt-4 border-t border-slate-200 pt-3 text-[11px] leading-5 text-slate-500">{t.results.derate}</p>
    </SidePanel>
  );
}
