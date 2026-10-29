'use client';

import { useI18n } from '@/lib/i18n';
import type { Tool } from '@/lib/design/state';
import { pillClass } from './ui';

const TOOLS: Array<{ tool: Tool; icon: string; key: string }> = [
  { tool: 'select', icon: '↖', key: 'V' },
  { tool: 'add', icon: '＋', key: 'A' },
  { tool: 'erase', icon: '⌫', key: 'E' },
];

export function SceneToolbar({ tool, editable, onToolChange, onResetView, onTopView }: {
  tool: Tool;
  editable: boolean;
  onToolChange: (tool: Tool) => void;
  onResetView: () => void;
  onTopView: () => void;
}) {
  const { t } = useI18n();
  const button = 'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition';
  return (
    <div className="pointer-events-auto flex flex-col gap-2 self-start">
      {editable && (
        <div role="toolbar" aria-label={t.tools.label} className={`${pillClass} flex flex-col gap-1 p-1.5`}>
          {TOOLS.map((item) => (
            <button
              key={item.tool}
              type="button"
              aria-pressed={tool === item.tool}
              title={`${t.tools[item.tool]} (${item.key})`}
              onClick={() => onToolChange(item.tool)}
              className={`${button} ${tool === item.tool ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              <span className="w-4 text-center text-sm">{item.icon}</span>
              <span className="hidden sm:inline">{t.tools[item.tool]}</span>
              <kbd className="ml-auto hidden font-sans text-[10px] opacity-60 sm:inline">{item.key}</kbd>
            </button>
          ))}
        </div>
      )}
      <div className={`${pillClass} flex flex-col gap-1 p-1.5`}>
        <button type="button" title={t.tools.resetView} onClick={onResetView} className={`${button} text-slate-700 hover:bg-slate-100`}>
          <span className="w-4 text-center text-sm">⟲</span><span className="hidden sm:inline">{t.tools.resetView}</span>
        </button>
        <button type="button" title={t.tools.topView} onClick={onTopView} className={`${button} text-slate-700 hover:bg-slate-100`}>
          <span className="w-4 text-center text-sm">⊙</span><span className="hidden sm:inline">{t.tools.topView}</span>
        </button>
      </div>
    </div>
  );
}

export function ToolHint({ tool, editable }: { tool: Tool; editable: boolean }) {
  const { t } = useI18n();
  const hint = editable ? { select: t.tools.selectHint, add: t.tools.addHint, erase: t.tools.eraseHint }[tool] : null;
  return (
    <p className="hidden rounded-full bg-slate-900/75 px-3 py-1.5 text-center text-[11px] text-white/90 backdrop-blur-md md:block">
      {hint && <>{hint} · </>}{t.tools.orbitHint}
    </p>
  );
}
