'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { TOUR_STEPS } from '@/lib/design/tour';
import { cardClass, primaryButtonClass } from './ui';

type Rect = { left: number; top: number; width: number; height: number };

const CARD_WIDTH = 340;
const GAP = 12;
const MARGIN = 16;

// Follows a `data-tour` element on screen, scrolled into view when the step opens.
function useTargetRect(target: string | null, index: number): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!target || target === 'scene') return;
    let frame = 0;
    let scrolled = false;
    let last = '';
    const measure = () => {
      const element = document.querySelector(`[data-tour="${target}"]`);
      if (element && !scrolled) {
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        scrolled = true;
      }
      const box = element?.getBoundingClientRect();
      const next = box && box.width > 0 ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
      const key = next ? `${Math.round(next.left)}:${Math.round(next.top)}:${Math.round(next.width)}:${Math.round(next.height)}` : '';
      if (key !== last) {
        last = key;
        setRect(next);
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [index, target]);
  return target && target !== 'scene' ? rect : null;
}

// Below, above, left or right of the target, whichever fits first.
function placeCard(rect: Rect, height: number) {
  const width = Math.min(CARD_WIDTH, window.innerWidth - MARGIN * 2);
  const clampX = (x: number) => Math.min(Math.max(MARGIN, x), window.innerWidth - width - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(MARGIN, y), window.innerHeight - height - MARGIN);
  if (rect.top + rect.height + GAP + height < window.innerHeight - MARGIN) return { left: clampX(rect.left), top: rect.top + rect.height + GAP, width };
  if (rect.top - GAP - height > MARGIN) return { left: clampX(rect.left), top: rect.top - GAP - height, width };
  if (rect.left - GAP - width > MARGIN) return { left: rect.left - GAP - width, top: clampY(rect.top), width };
  return { left: clampX(rect.left + rect.width + GAP), top: clampY(rect.top), width };
}

// A guided walk through the studio: spotlights one control per step and
// explains it, while the studio performs the step on the example building.
export function TourOverlay({ index, ready, onNext, onClose }: {
  index: number;
  // The step's setup has finished (a building loaded, a layout generated).
  ready: boolean;
  onNext: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const step = TOUR_STEPS[index];
  const copy = t.tour.steps[step.id];
  const rect = useTargetRect(step.target, index);
  const [cardHeight, setCardHeight] = useState(220);
  const last = index === TOUR_STEPS.length - 1;
  const counted = TOUR_STEPS.length - 2;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const scene = step.target === 'scene';
  const position = rect
    ? placeCard(rect, cardHeight)
    : scene
      ? { left: MARGIN, top: Math.max(MARGIN, window.innerHeight - cardHeight - 150), width: Math.min(CARD_WIDTH, window.innerWidth - MARGIN * 2) }
      : { left: (window.innerWidth - Math.min(400, window.innerWidth - MARGIN * 2)) / 2, top: Math.max(MARGIN, (window.innerHeight - cardHeight) / 2), width: Math.min(400, window.innerWidth - MARGIN * 2) };

  return (
    // Blocks the studio while the tour drives it; the roof stays visible on scene steps.
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t.tour.label}>
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-[18px] outline outline-2 outline-accent transition-all duration-300"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: '0 0 0 9999px rgb(15 23 42 / 0.45)' }}
        />
      ) : !scene && <div className="absolute inset-0 bg-slate-950/45" />}
      <section
        ref={(element) => {
          if (element && Math.abs(element.offsetHeight - cardHeight) > 1) setCardHeight(element.offsetHeight);
        }}
        className={`${cardClass} absolute !bg-white/95 p-5 shadow-[0_18px_50px_rgb(15_23_42/0.28)] transition-[left,top] duration-300`}
        style={position}
      >
        {index > 0 && !last && <p className="text-[12px] font-medium text-accent">{t.tour.progress(index, counted)}</p>}
        <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.01em]">{copy.title}</h2>
        <p className="mt-2 text-[14px] leading-6 text-label-secondary">{copy.body}</p>
        <div className="mt-4 flex items-center gap-3">
          {!last && (
            <button type="button" onClick={onClose} className="shrink-0 text-[14px] text-label-secondary hover:text-label">
              {index === 0 ? t.tour.notNow : t.tour.skip}
            </button>
          )}
          <button type="button" disabled={!ready} onClick={last ? onClose : onNext} className={`${primaryButtonClass} ml-auto !w-auto`}>
            {!ready ? t.tour.waiting : index === 0 ? t.tour.start : last ? t.tour.finish : t.tour.next}
          </button>
        </div>
      </section>
    </div>
  );
}
