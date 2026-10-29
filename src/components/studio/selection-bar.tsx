'use client';

import { useI18n } from '@/lib/i18n';
import { pillClass } from './ui';

export function SelectionBar({ count, onRotate, onToggleOrientation, onSelectRow, onSelectRoof, onSelectAll, onDelete, onDeselect }: {
  count: number;
  onRotate: (degrees: number) => void;
  onToggleOrientation: () => void;
  onSelectRow: () => void;
  onSelectRoof: () => void;
  onSelectAll: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}) {
  const { t } = useI18n();
  const button = 'rounded-xl px-2.5 py-1.5 text-xs text-slate-700 transition hover:bg-slate-100';
  const divider = <span className="mx-0.5 h-5 w-px bg-slate-200" />;
  return (
    <div role="toolbar" aria-label={t.selection.count(count)} className={`${pillClass} flex max-w-full flex-wrap items-center justify-center gap-1 px-2 py-1.5`}>
      <span className="px-2 text-xs font-semibold text-sky-700">{t.selection.count(count)}</span>
      {divider}
      <button type="button" className={button} title={t.selection.rotateLeft} aria-label={t.selection.rotateLeft} onClick={() => onRotate(-5)}>↶ 5°</button>
      <button type="button" className={button} title={t.selection.rotateRight} aria-label={t.selection.rotateRight} onClick={() => onRotate(5)}>5° ↷</button>
      <button type="button" className={button} onClick={onToggleOrientation}>{t.selection.orientation}</button>
      {divider}
      <button type="button" className={button} onClick={onSelectRow}>{t.selection.row}</button>
      <button type="button" className={button} onClick={onSelectRoof}>{t.selection.roof}</button>
      <button type="button" className={button} title="Ctrl+A" onClick={onSelectAll}>{t.selection.all}</button>
      {divider}
      <button type="button" className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50" title="Delete" onClick={onDelete}>{t.selection.delete}</button>
      <button type="button" className={button} title="Esc" aria-label={t.selection.deselect} onClick={onDeselect}>✕</button>
    </div>
  );
}
