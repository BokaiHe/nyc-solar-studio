'use client';

import type { ReactNode } from 'react';

import type { PanelSize } from '@/lib/design/geometry';
import { useI18n } from '@/lib/i18n';
import type { DesignSummary } from '@/lib/solar/calculations';
import { Eyebrow, Metric, PanelTitle, primaryButtonClass, secondaryButtonClass, SidePanel, SliderField } from './ui';

// ERA5 weather reads 5–8% sunnier than NREL's for New York, so a
// PVWatts-equivalent estimate is the result divided by 1.05–1.08.
const PVWATTS_RANGE = [1 / 1.08, 1 / 1.05];

export function ResultsPanel({ summary, rate, onRateChange, onShare, copied, onBack, onDrawKeepOut, workspace, keepOutCount, panelSize, panelWatts, modelRelease }: {
  workspace?: ReactNode;
  keepOutCount: number;
  onDrawKeepOut: () => void;
  panelSize: PanelSize;
  panelWatts: number;
  modelRelease: string;
  summary: DesignSummary;
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
        <Metric label={t.results.energy} value={formatNumber(summary.annualAcKwh, 'kWh')} detail={t.results.energyDetail(Math.round(summary.specificYield), Math.round(summary.efficiency * 100))} />
        <Metric label={t.results.carbon} value={formatNumber(summary.annualCarbonKg, 'kg')} detail={summary.annualCarbonKg === null ? t.results.carbonMissing : t.results.carbonDetail} />
        <Metric label={t.results.savings} value={`$${Math.round(summary.annualElectricityValueUsd).toLocaleString()}`} detail={t.results.savingsDetail} />
      </div>
      <p className="mt-3 text-[12px] leading-5 text-label-secondary">{t.results.note}</p>
      {workspace}

      <div className="mt-4 rounded-[14px] bg-fill/60 p-3">
        <SliderField label={t.results.rate} value={rate} min={0.05} max={0.6} step={0.005} format={(value) => `$${value.toFixed(3)}`} onChange={onRateChange} />
      </div>

      <button type="button" onClick={onShare} className={`${primaryButtonClass} mt-4`}>{t.results.share}</button>
      {copied && <p className="mt-2 text-center text-[13px] font-medium text-success" role="status">{t.results.copied}</p>}
      <button type="button" onClick={onBack} className={`${secondaryButtonClass} mt-2 w-full py-2.5`}>{t.results.back}</button>
      <section className="mt-4 border-t border-separator pt-3 text-[12px] leading-5 text-label-secondary" aria-label={t.results.basisTitle}>
        <p className="text-[13px] font-semibold text-label">{t.results.basisTitle}</p>
        {keepOutCount === 0 ? (
          <div className="mt-2 rounded-[10px] bg-warning/12 px-2.5 py-2 text-[#9a5b00]">
            <p>{t.results.keepOutNone}</p>
            <button type="button" onClick={onDrawKeepOut} className="mt-1 font-semibold text-accent">{t.results.drawKeepOut}</button>
          </div>
        ) : (
          <p className="mt-2">{t.results.keepOutSome(keepOutCount)}</p>
        )}
        <ul className="mt-2 list-disc space-y-1.5 pl-4">
          <li>
            {t.results.energyBasis}
            {summary.annualAcKwh !== null && summary.annualAcKwh > 0 && (
              <> {t.results.pvwattsRange(...PVWATTS_RANGE.map((factor) => Math.round(summary.annualAcKwh! * factor).toLocaleString()) as [string, string])}</>
            )}
          </li>
          <li>{t.results.sunBasis}</li>
          <li>{t.results.modelBasis(modelRelease, panelSize.widthMeters.toFixed(2), panelSize.heightMeters.toFixed(2), Math.round(panelWatts))}</li>
        </ul>
      </section>
    </SidePanel>
  );
}
