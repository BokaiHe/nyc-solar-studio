'use client';

import { useI18n } from '@/lib/i18n';
import type { Building } from '@/lib/design/state';
import { Eyebrow, primaryButtonClass, SidePanel } from './ui';

function formatImageryDate({ year, month, day }: { year: number; month: number; day: number }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function SelectPanel({ building, onStart }: { building: Building; onStart: () => void }) {
  const { t } = useI18n();
  const { status, model, insights } = building;

  if (status === 'idle') {
    return (
      <SidePanel>
        <Eyebrow>NYC Solar Studio</Eyebrow>
        <h1 className="mt-2 text-lg font-semibold">{t.select.idleTitle}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{t.select.idleBody}</p>
      </SidePanel>
    );
  }

  if (status === 'loading') {
    return (
      <SidePanel>
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          <div>
            <p className="text-sm font-semibold">{t.select.loadingTitle}</p>
            <p className="mt-0.5 text-xs text-slate-500">{t.select.loadingBody}</p>
          </div>
        </div>
      </SidePanel>
    );
  }

  if (status === 'no-model' || status === 'error' || !model) {
    return (
      <SidePanel>
        <p className="text-sm font-semibold text-amber-700">{status === 'no-model' ? t.select.noModelTitle : t.select.errorTitle}</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{status === 'no-model' ? t.select.noModelBody : t.select.errorBody}</p>
      </SidePanel>
    );
  }

  return (
    <SidePanel>
      <Eyebrow>{t.select.eyebrow}</Eyebrow>
      <h2 className="mt-2 text-lg font-semibold">{model.modelAddress || building.label}</h2>
      <div className="mt-3 space-y-1 text-xs leading-5 text-slate-600">
        {model.nycBin && <p>BIN {model.nycBin}</p>}
        <p>{t.select.modelHeight(model.modelHeightMeters?.toFixed(1) ?? '—', model.modelRelease ?? '')}</p>
        <p className="text-[11px] text-slate-500">{t.select.modelSource}</p>
      </div>
      <p className={`mt-3 rounded-xl px-3 py-2 text-xs ${insights ? 'bg-sky-50 text-sky-800' : 'bg-amber-50 text-amber-800'}`}>
        {insights
          ? t.select.googleReady(t.quality[insights.imageryQuality], formatImageryDate(insights.imageryDate))
          : t.select.googleMissing}
      </p>
      <button type="button" onClick={onStart} className={`${primaryButtonClass} mt-5`}>{t.select.start}</button>
    </SidePanel>
  );
}
