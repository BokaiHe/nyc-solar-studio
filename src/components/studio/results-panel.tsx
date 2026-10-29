'use client';

import { useI18n } from '@/lib/i18n';
import type { DesignSummary } from '@/lib/solar/calculations';
import { Eyebrow, Metric, PanelTitle, primaryButtonClass, secondaryButtonClass, SidePanel, SliderField } from './ui';

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
      <div className="mt-0.5"><PanelTitle>{t.results.title(summary.capacityKw.toFixed(1))}</PanelTitle></div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label={t.results.panels} value={t.results.panelCount(summary.panelCount)} detail={t.results.layout} />
        <Metric label={t.results.energy} value={formatNumber(summary.annualAcKwh, 'kWh')} detail={t.results.energyDetail} />
        <Metric label={t.results.carbon} value={formatNumber(summary.annualCarbonKg, 'kg')} detail={t.results.carbonDetail} />
        <Metric label={t.results.savings} value={summary.annualElectricityValueUsd === null ? t.results.unavailable : `$${Math.round(summary.annualElectricityValueUsd).toLocaleString()}`} detail={t.results.savingsDetail} />
      </div>
      <p className="mt-3 text-[12px] leading-5 text-label-secondary">{hasGoogleData ? t.results.note : t.results.noGoogle}</p>

      <div className="mt-4 rounded-[14px] bg-fill/60 p-3">
        <SliderField label={t.results.rate} value={rate} min={0.05} max={0.6} step={0.005} format={(value) => `$${value.toFixed(3)}`} onChange={onRateChange} />
      </div>

      <button type="button" onClick={onShare} className={`${primaryButtonClass} mt-4`}>{t.results.share}</button>
      {copied && <p className="mt-2 text-center text-[13px] font-medium text-success" role="status">{t.results.copied}</p>}
      <button type="button" onClick={onBack} className={`${secondaryButtonClass} mt-2 w-full py-2.5`}>{t.results.back}</button>
      <p className="mt-4 border-t border-separator pt-3 text-[12px] leading-5 text-label-tertiary">{t.results.derate}</p>
    </SidePanel>
  );
}
