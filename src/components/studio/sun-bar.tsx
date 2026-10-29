'use client';

import { useI18n } from '@/lib/i18n';
import type { SunSnapshot } from '@/lib/solar/types';
import { pillClass } from './ui';

function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function SunBar({ dateIso, onDateChange, minuteOfDay, onMinuteChange, playing, onPlayingChange, sun, directLight }: {
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
  return (
    <section className={`${pillClass} flex w-full max-w-3xl flex-col gap-1.5 px-4 py-2.5`}>
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label={t.sun.date} type="date" value={dateIso} onChange={(event) => event.target.value && onDateChange(event.target.value)} className="rounded-[8px] bg-fill px-2.5 py-1 text-[13px] tabular-nums text-label outline-none" />
        <button type="button" onClick={() => onPlayingChange(!playing)} className="grid h-8 w-8 place-items-center rounded-full bg-fill text-[12px] text-label transition hover:bg-fill-strong active:scale-95" aria-label={playing ? t.sun.pause : t.sun.play}>
          {playing ? 'Ⅱ' : '▶'}
        </button>
        <span className="w-11 text-[15px] font-semibold tabular-nums">{minuteLabel(minuteOfDay)}</span>
        <input aria-label={t.sun.time} type="range" min="0" max="1439" step="5" value={minuteOfDay} onChange={(event) => { onPlayingChange(false); onMinuteChange(Number(event.target.value)); }} className="apple-slider solar-time-slider min-w-40 flex-1" />
      </div>
      <p className="text-[12px] tabular-nums text-label-secondary">
        {sun && t.sun.position(sun.azimuthDegrees.toFixed(0), sun.altitudeDegrees.toFixed(0))}
        {directLight !== null && ` · ${t.sun.direct(Math.round(directLight * 100))}`}
      </p>
    </section>
  );
}
