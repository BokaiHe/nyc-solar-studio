'use client';

import { useI18n } from '@/lib/i18n';
import type { Tool } from '@/lib/design/state';
import { pillClass, segmentClass } from './ui';

const TOOLS: Array<{ tool: Tool; icon: string; key: string }> = [
  { tool: 'select', icon: '↖', key: 'V' },
  { tool: 'add', icon: '＋', key: 'A' },
  { tool: 'erase', icon: '⌫', key: 'E' },
  { tool: 'zone', icon: '⬠', key: 'Z' },
];

export function SceneToolbar({ tool, editable, onToolChange, onResetView, planView, onTopView, neighborsAvailable, showNeighbors, onToggleNeighbors, basemapAvailable, showBasemap, onToggleBasemap }: {
  tool: Tool;
  editable: boolean;
  onToolChange: (tool: Tool) => void;
  onResetView: () => void;
  // The flat plan view is on; the button turns it off again.
  planView: boolean;
  onTopView: () => void;
  neighborsAvailable: boolean;
  showNeighbors: boolean;
  onToggleNeighbors: () => void;
  basemapAvailable: boolean;
  showBasemap: boolean;
  onToggleBasemap: () => void;
}) {
  const { t } = useI18n();
  // A horizontal bar along the top of the scene: editing tools, then view
  // toggles. Labels hide on phones, where the icons carry the meaning.
  const toggle = (on: boolean) => `flex items-center gap-2 rounded-[11px] px-3 py-2 text-[15px] font-medium transition hover:bg-fill active:scale-[0.97] ${on ? 'text-label' : 'text-label-secondary'}`;
  return (
    <div data-tour="toolbar" className="pointer-events-auto flex flex-wrap items-center gap-2 self-start">
      {editable && (
        <div role="toolbar" aria-label={t.tools.label} className={`${pillClass} p-1`}>
          <div className="flex gap-0.5 rounded-[12px] bg-fill p-[3px]">
            {TOOLS.map((item) => (
              <button
                key={item.tool}
                type="button"
                aria-pressed={tool === item.tool}
                title={`${t.tools[item.tool]} (${item.key})`}
                onClick={() => onToolChange(item.tool)}
                className={`${segmentClass(tool === item.tool)} flex items-center gap-2 !px-3.5 !py-2 !text-[15px]`}
              >
                <span className={`text-[17px] leading-none ${tool === item.tool ? 'text-accent' : ''}`}>{item.icon}</span>
                <span className="hidden sm:inline">{t.tools[item.tool]}</span>
                <kbd className="hidden font-sans text-[12px] text-label-tertiary lg:inline">{item.key}</kbd>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={`${pillClass} flex gap-0.5 p-1`}>
        <button type="button" title={t.tools.resetView} onClick={onResetView} className={toggle(true)}>
          <span className="text-[17px] leading-none text-label-secondary">⟲</span><span className="hidden sm:inline">{t.tools.resetView}</span>
        </button>
        <button type="button" aria-pressed={planView} title={t.tools.topView} onClick={onTopView} className={`${toggle(true)} ${planView ? 'bg-accent/10' : ''}`}>
          <span className={`text-[17px] leading-none ${planView ? 'text-accent' : 'text-label-secondary'}`}>⊙</span><span className="hidden sm:inline">{t.tools.topView}</span>
        </button>
        {basemapAvailable && (
          <button type="button" aria-pressed={showBasemap} title={t.tools.basemap} onClick={onToggleBasemap} className={toggle(showBasemap)}>
            <span className={`text-[17px] leading-none ${showBasemap ? 'text-accent' : 'text-label-tertiary'}`}>◩</span>
            <span className="hidden sm:inline">{t.tools.basemap}</span>
          </button>
        )}
        {neighborsAvailable && (
          <button type="button" aria-pressed={showNeighbors} title={t.tools.neighbors} onClick={onToggleNeighbors} className={toggle(showNeighbors)}>
            <span className={`text-[17px] leading-none ${showNeighbors ? 'text-accent' : 'text-label-tertiary'}`}>▦</span>
            <span className="hidden sm:inline">{t.tools.neighbors}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function ToolHint({ tool, editable, planView }: { tool: Tool; editable: boolean; planView: boolean }) {
  const { t } = useI18n();
  const hint = editable ? { select: t.tools.selectHint, add: t.tools.addHint, erase: t.tools.eraseHint, zone: t.tools.zoneHint }[tool] : null;
  return (
    <p className={`${pillClass} hidden px-3.5 py-2 text-center text-[13px] text-label-secondary md:block`}>
      {hint && <>{hint} · </>}{planView ? t.tools.planHint : t.tools.orbitHint}
    </p>
  );
}
