import { useId, useState, type CSSProperties, type ReactNode } from 'react';

// Floating surfaces use the translucent materials from globals.css.
export const cardClass = 'pointer-events-auto material rounded-[22px] text-label';
export const pillClass = 'pointer-events-auto material-chip rounded-[14px] text-label';
// Filled and gray ("tinted") buttons; both react on press, not on release.
export const primaryButtonClass = 'w-full rounded-[12px] bg-accent px-4 py-2.5 text-[15px] font-semibold tracking-[-0.01em] text-white transition active:scale-[0.98] active:bg-accent-pressed disabled:pointer-events-none disabled:opacity-35';
export const secondaryButtonClass = 'rounded-[10px] bg-fill px-3 py-2 text-[13px] font-medium text-accent transition hover:bg-fill-strong active:scale-[0.97] disabled:pointer-events-none disabled:text-label-tertiary';

// Right-hand card on wide screens; a bottom sheet on narrow ones.
export function SidePanel({ children }: { children: ReactNode }) {
  return (
    <aside data-tour="panel" className={`${cardClass} max-h-[46dvh] w-full overflow-y-auto p-4 md:max-h-full md:w-[340px] md:p-5`}>
      {children}
    </aside>
  );
}

// Small secondary heading above a panel title (sentence case, like iOS group headers).
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-semibold text-label-secondary">{children}</p>;
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">{children}</h2>;
}

export function GroupTitle({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-semibold text-label-secondary">{children}</p>;
}

export function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[14px] bg-fill p-3">
      <p className="text-[12px] text-label-secondary">{label}</p>
      <p className="mt-0.5 text-[20px] font-semibold tabular-nums tracking-[-0.02em]">{value}</p>
      <p className="mt-0.5 text-[11px] tracking-[0.01em] text-label-secondary">{detail}</p>
    </div>
  );
}

// A slider with a live value on the right. The value is also a borderless
// field, so an exact number can still be typed.
export function SliderField({ label, value, min, max, step = 1, unit = '', format, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const fill = `${((clamp(value) - min) / (max - min || 1)) * 100}%`;
  const shown = format ? format(value) : `${value}${unit}`;
  const commitDraft = () => {
    if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) onChange(clamp(Number(draft)));
    setDraft(null);
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] text-label">{label}</label>
        {draft === null ? (
          <button type="button" onClick={() => setDraft(String(value))} className="rounded-md px-1 text-[13px] tabular-nums text-label-secondary hover:bg-fill" aria-label={`${label}: ${shown}`}>
            {shown}
          </button>
        ) : (
          <input
            autoFocus
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitDraft();
              if (event.key === 'Escape') setDraft(null);
            }}
            className="value-input w-16 rounded-md bg-fill px-1 text-right text-[13px] tabular-nums text-label outline-none"
          />
        )}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamp(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="apple-slider mt-1"
        style={{ '--fill': fill } as CSSProperties}
      />
    </div>
  );
}

// iOS-style switch on the right of its label, as in a settings list row.
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] leading-5 text-label">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-success' : 'bg-fill-strong'}`}
      >
        <span
          className={`absolute left-[2px] top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_1px_1px_rgb(0_0_0/0.16)] transition-transform duration-200 ease-[cubic-bezier(0.3,0.7,0.4,1)] ${checked ? 'translate-x-[18px]' : ''}`}
        />
      </button>
    </div>
  );
}

// Segmented control segment: a raised white segment marks the current choice
// on a gray track (the track itself is `bg-fill rounded-[11px] p-[2px]`).
export function segmentClass(active: boolean) {
  return `rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-35 ${active
    ? 'bg-white text-label shadow-[0_3px_8px_rgb(0_0_0/0.12),0_1px_1px_rgb(0_0_0/0.04)]'
    : 'text-label hover:bg-white/50'}`;
}
