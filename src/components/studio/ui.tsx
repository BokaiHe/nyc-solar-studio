import type { ReactNode } from 'react';

export const cardClass = 'pointer-events-auto rounded-3xl border border-slate-200 bg-white/95 text-slate-900 shadow-xl backdrop-blur-xl';
export const pillClass = 'pointer-events-auto rounded-2xl border border-slate-200 bg-white/95 text-slate-900 shadow-lg backdrop-blur-xl';
export const primaryButtonClass = 'w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300';
export const secondaryButtonClass = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';

// Right-hand card on wide screens; a bottom sheet on narrow ones.
export function SidePanel({ children }: { children: ReactNode }) {
  return (
    <aside className={`${cardClass} max-h-[46dvh] w-full overflow-y-auto p-4 md:max-h-full md:w-[340px] md:p-5`}>
      {children}
    </aside>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-700">{children}</p>;
}

export function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

export function NumberField({ label, value, min, max, step = 1, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-xs text-slate-500">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value !== '' && Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-slate-600">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-sky-600" />
      {label}
    </label>
  );
}
