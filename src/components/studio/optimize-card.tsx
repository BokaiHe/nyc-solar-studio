'use client';

import { useI18n } from '@/lib/i18n';
import type { LayoutOption, Objective, OptimizerResult } from '@/lib/design/optimizer';
import { GroupTitle, primaryButtonClass, secondaryButtonClass, segmentClass } from './ui';

export type OptimizerState =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number }
  | { status: 'done'; result: OptimizerResult; stale: boolean }
  | { status: 'error' };

export function OptimizeCard({ objective, onObjectiveChange, state, panelWatts, appliedKey, onRun, onApply }: {
  objective: Objective;
  onObjectiveChange: (objective: Objective) => void;
  state: OptimizerState;
  panelWatts: number;
  // `${tilt}:${gap}` of the option whose layout is on the roof now, if any.
  appliedKey: string | null;
  onRun: () => void;
  onApply: (option: LayoutOption) => void;
}) {
  const { t } = useI18n();
  const running = state.status === 'running';
  const result = state.status === 'done' ? state.result : null;
  const baseline = result?.current.yieldIndex ?? 0;

  return (
    <section className="mt-4">
      <GroupTitle>{t.optimize.title}</GroupTitle>
      <div className="mt-2 rounded-[14px] bg-fill/60 p-3">
        <div className="flex rounded-[11px] bg-fill p-[2px]" role="radiogroup" aria-label={t.optimize.title}>
          {(['max-total', 'balanced'] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={objective === item}
              disabled={running}
              onClick={() => onObjectiveChange(item)}
              className={`${segmentClass(objective === item)} flex-1`}
            >
              {item === 'max-total' ? t.optimize.objectiveMax : t.optimize.objectiveBalanced}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-5 text-label-secondary">{objective === 'max-total' ? t.optimize.hintMax : t.optimize.hintBalanced}</p>

        {running ? (
          <div className="mt-3" role="status">
            <div className="h-1 overflow-hidden rounded-full bg-fill-strong">
              <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${(state.done / state.total) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-[12px] tabular-nums text-label-secondary">{t.optimize.running(state.done, state.total)}</p>
          </div>
        ) : (
          <button type="button" onClick={onRun} className={`${result ? secondaryButtonClass : primaryButtonClass} mt-3 w-full`}>
            {result ? t.optimize.rerun : t.optimize.run}
          </button>
        )}
        {state.status === 'error' && <p className="mt-2 text-[12px] text-destructive">{t.optimize.failed}</p>}

        {result && (
          <div className="mt-3 space-y-2">
            {state.status === 'done' && state.stale && <p className="text-[12px] text-[#9a5b00]">{t.optimize.stale}</p>}
            {result.options.map((option, index) => {
              const key = `${option.params.tiltDegrees}:${option.params.rowSpacingMeters}`;
              const applied = appliedKey === key;
              const gain = baseline ? Math.round((option.yieldIndex / baseline - 1) * 100) : 0;
              return (
                <div key={key} className={`rounded-[12px] bg-white p-3 shadow-[0_1px_2px_rgb(0_0_0/0.06)] ${index === 0 ? 'ring-1 ring-accent/40' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold">{t.optimize.option(option.params.tiltDegrees, option.params.rowSpacingMeters.toFixed(1))}</p>
                      <p className="mt-0.5 text-[12px] tabular-nums text-label-secondary">{t.optimize.stats(option.panels.length, ((option.panels.length * panelWatts) / 1000).toFixed(1))}</p>
                    </div>
                    <button
                      type="button"
                      disabled={applied || (state.status === 'done' && state.stale)}
                      onClick={() => onApply(option)}
                      className={`${secondaryButtonClass} shrink-0 px-3 py-1.5`}
                    >
                      {applied ? t.optimize.applied : t.optimize.apply}
                    </button>
                  </div>
                  <div className="mt-2 flex gap-3 text-[12px] font-medium tabular-nums">
                    <span className={gain > 0 ? 'text-success' : gain < 0 ? 'text-destructive' : 'text-label-secondary'}>{t.optimize.gain(gain)}</span>
                    <span className="text-label-secondary">{t.optimize.efficiency(Math.round(option.efficiency * 100))}</span>
                  </div>
                </div>
              );
            })}
            <p className="pt-1 text-[11px] leading-4 text-label-tertiary">{t.optimize.note}</p>
          </div>
        )}
      </div>
    </section>
  );
}
