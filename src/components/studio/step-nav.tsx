'use client';

import { useI18n } from '@/lib/i18n';
import type { Step } from '@/lib/design/state';
import { pillClass } from './ui';

const STEPS: Step[] = ['select', 'design', 'results'];

export function StepNav({ step, designReady, onChange }: { step: Step; designReady: boolean; onChange: (step: Step) => void }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t.steps.label} className={`${pillClass} flex p-1`}>
      {STEPS.map((item, index) => {
        const active = item === step;
        const disabled = item !== 'select' && !designReady;
        return (
          <button
            key={item}
            type="button"
            disabled={disabled}
            aria-current={active ? 'step' : undefined}
            onClick={() => onChange(item)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
          >
            <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${active ? 'bg-white text-slate-900' : 'bg-slate-200 text-slate-600'}`}>{index + 1}</span>
            {t.steps[item]}
          </button>
        );
      })}
    </nav>
  );
}
