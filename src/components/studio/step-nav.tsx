'use client';

import { useI18n } from '@/lib/i18n';
import type { Step } from '@/lib/design/state';
import { pillClass, segmentClass } from './ui';

const STEPS: Step[] = ['select', 'design', 'results'];

export function StepNav({ step, designReady, onChange }: { step: Step; designReady: boolean; onChange: (step: Step) => void }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t.steps.label} className={`${pillClass} p-1`}>
      <div className="flex rounded-[11px] bg-fill p-[2px]">
        {STEPS.map((item, index) => {
          const active = item === step;
          return (
            <button
              key={item}
              type="button"
              disabled={item !== 'select' && !designReady}
              aria-current={active ? 'step' : undefined}
              onClick={() => onChange(item)}
              className={`${segmentClass(active)} flex items-center gap-1.5`}
            >
              <span className={`tabular-nums ${active ? 'text-accent' : 'text-label-secondary'}`}>{index + 1}</span>
              <span className={active ? '' : 'hidden sm:inline'}>{t.steps[item]}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
