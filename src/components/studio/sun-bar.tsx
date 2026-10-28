'use client';

import { useI18n } from '@/lib/i18n';
import type { SunSnapshot } from '@/lib/solar/types';
import { pillClass } from './ui';

function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function SunBar({ open, onToggle, dateIso, onDateChange, minuteOfDay, onMinuteChange, playing, onPlayingChange, sun, directLight }: {
  open: boolean;
  onToggle: () => void;
  dateIso: string;
  onDateChange: (value: string) => void;
  minuteOfDay: number;
  onMinuteChange: (value: number) => void;
  playing: boolean;
  onPlayingChange: (value: boolean) => void;
  sun: SunSnapshot | null;
  directLight: number | null;
}) {
  const { t } = useI18n();
  if (!open) {
    return (
      <button type="button" onClick={onToggle} className={`${pillClass} px-4 py-2.5 text-sm font-medium`}>
        ☀ {t.sun.toggle} · {minuteLabel(minuteOfDay)}
      </button>
    );
  }
  return (
    <section className={`${pillClass} flex w-full max-w-3xl flex-col gap-2 px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label={t.sun.date} type="date" value={dateIso} onChange={(event) => event.target.value && onDateChange(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm" />
        <button type="button" onClick={() => onPlayingChange(!playing)} className="grid h-9 w-9 place-items-center rounded-full bg-amber-400 text-sm font-semibold text-slate-950" aria-label={playing ? t.sun.pause : t.sun.play}>
          {playing ? 'Ⅱ' : '▶'}
        </button>
        <span className="w-12 font-mono text-sm text-amber-700">{minuteLabel(minuteOfDay)}</span>
        <input aria-label={t.sun.time} type="range" min="0" max="1439" step="5" value={minuteOfDay} onChange={(event) => { onPlayingChange(false); onMinuteChange(Number(event.target.value)); }} className="solar-time-slider h-2 min-w-40 flex-1 cursor-pointer" />
        <button type="button" onClick={onToggle} className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100" aria-label={t.sun.hide}>×</button>
      </div>
      <p className="text-xs text-slate-500">
        {sun && t.sun.position(sun.azimuthDegrees.toFixed(0), sun.altitudeDegrees.toFixed(0))}
        {directLight !== null && ` · ${t.sun.direct(Math.round(directLight * 100))}`}
      </p>
    </section>
  );
}
