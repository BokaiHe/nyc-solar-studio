'use client';

import { useI18n } from '@/lib/i18n';
import type { Building } from '@/lib/design/state';
import { Eyebrow, primaryButtonClass, SidePanel } from './ui';

export function SelectPanel({ building, onStart }: { building: Building; onStart: () => void }) {
  const { t } = useI18n();
  const { status, model } = building;

  if (status === 'idle') {
    return (
      <SidePanel>
        <Eyebrow>NYC Solar Studio</Eyebrow>
        <h1 className="mt-1 text-[22px] font-bold leading-tight tracking-[-0.02em]">{t.select.idleTitle}</h1>
        <p className="mt-2 text-[15px] leading-6 text-label-secondary">{t.select.idleBody}</p>
      </SidePanel>
    );
  }

  if (status === 'loading') {
    return (
      <SidePanel>
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-fill-strong border-t-label-secondary" />
          <div>
            <p className="text-[15px] font-semibold">{t.select.loadingTitle}</p>
            <p className="mt-0.5 text-[13px] text-label-secondary">{t.select.loadingBody}</p>
          </div>
        </div>
      </SidePanel>
    );
  }

  if (status === 'no-model' || status === 'outside' || status === 'error' || !model) {
    const copy = status === 'outside'
      ? [t.select.outsideTitle, t.select.outsideBody]
      : status === 'no-model' ? [t.select.noModelTitle, t.select.noModelBody] : [t.select.errorTitle, t.select.errorBody];
    return (
      <SidePanel>
        <p className="text-[17px] font-semibold tracking-[-0.01em]">{copy[0]}</p>
        <p className="mt-1.5 text-[15px] leading-6 text-label-secondary">{copy[1]}</p>
      </SidePanel>
    );
  }

  return (
    <SidePanel>
      <Eyebrow>{t.select.eyebrow}</Eyebrow>
      <h2 className="mt-1 text-[22px] font-bold leading-tight tracking-[-0.02em]">{model.modelAddress || building.label}</h2>
      <div className="mt-3 space-y-0.5 text-[13px] leading-5 text-label-secondary">
        {model.nycBin && <p>BIN {model.nycBin}</p>}
        <p>{t.select.modelHeight(model.modelHeightMeters?.toFixed(1) ?? '—', model.modelRelease ?? '')}</p>
        <p className="pt-1 text-[12px] text-label-tertiary">{t.select.modelSource}</p>
      </div>
      <button type="button" onClick={onStart} className={`${primaryButtonClass} mt-5`}>{t.select.start}</button>
    </SidePanel>
  );
}
