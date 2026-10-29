'use client';

import { useI18n } from '@/lib/i18n';
import type { Tool } from '@/lib/design/state';
import { pillClass, segmentClass } from './ui';

const TOOLS: Array<{ tool: Tool; icon: string; key: string }> = [
  { tool: 'select', icon: '↖', key: 'V' },
  { tool: 'add', icon: '＋', key: 'A' },
  { tool: 'erase', icon: '⌫', key: 'E' },
];

export function SceneToolbar({ tool, editable, onToolChange, onResetView, onTopView, neighborsAvailable, showNeighbors, onToggleNeighbors }: {
  tool: Tool;
  editable: boolean;
  onToolChange: (tool: Tool) => void;
  onResetView: () => void;
  onTopView: () => void;
  neighborsAvailable: boolean;
  showNeighbors: boolean;
  onToggleNeighbors: () => void;
}) {
  const { t } = useI18n();
  const plain = 'flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-[13px] font-medium text-label transition hover:bg-fill active:scale-[0.97]';
  return (
    <div className="pointer-events-auto flex flex-col gap-2 self-start">
      {editable && (
        <div role="toolbar" aria-label={t.tools.label} className={`${pillClass} p-1`}>
          <div className="flex flex-col gap-0.5 rounded-[11px] bg-fill p-[2px]">
            {TOOLS.map((item) => (
              <button
                key={item.tool}
                type="button"
                aria-pressed={tool === item.tool}
                title={`${t.tools[item.tool]} (${item.key})`}
                onClick={() => onToolChange(item.tool)}
                className={`${segmentClass(tool === item.tool)} flex items-center gap-2 text-left`}
              >
                <span className={`w-4 text-center ${tool === item.tool ? 'text-accent' : ''}`}>{item.icon}</span>
                <span className="hidden sm:inline">{t.tools[item.tool]}</span>
                <kbd className="ml-auto hidden pl-3 font-sans text-[11px] text-label-tertiary sm:inline">{item.key}</kbd>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={`${pillClass} flex flex-col gap-0.5 p-1`}>
        <button type="button" title={t.tools.resetView} onClick={onResetView} className={plain}>
          <span className="w-4 text-center text-label-secondary">⟲</span><span className="hidden sm:inline">{t.tools.resetView}</span>
        </button>
        <button type="button" title={t.tools.topView} onClick={onTopView} className={plain}>
          <span className="w-4 text-center text-label-secondary">⊙</span><span className="hidden sm:inline">{t.tools.topView}</span>
        </button>
        {neighborsAvailable && (
          <button type="button" aria-pressed={showNeighbors} title={t.tools.neighbors} onClick={onToggleNeighbors} className={plain}>
            <span className={`w-4 text-center ${showNeighbors ? 'text-accent' : 'text-label-tertiary'}`}>▦</span>
            <span className="hidden sm:inline">{t.tools.neighbors}</span>
            <span className={`ml-auto hidden h-2 w-2 rounded-full sm:inline ${showNeighbors ? 'bg-accent' : 'bg-fill-strong'}`} />
          </button>
        )}
      </div>
    </div>
  );
}

export function ToolHint({ tool, editable }: { tool: Tool; editable: boolean }) {
  const { t } = useI18n();
  const hint = editable ? { select: t.tools.selectHint, add: t.tools.addHint, erase: t.tools.eraseHint }[tool] : null;
  return (
    <p className={`${pillClass} hidden px-3 py-1.5 text-center text-[12px] text-label-secondary md:block`}>
      {hint && <>{hint} · </>}{t.tools.orbitHint}
    </p>
  );
}
