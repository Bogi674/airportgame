import { useGameStore } from './stores/gameStore';
import { useToolStore, type Tool } from './stores/toolStore';
import { t, tDynamic } from './strings';

const TOOLS: { tool: Tool; icon: string }[] = [
  { tool: 'select', icon: '↖' },
  { tool: 'runway', icon: '═' },
  { tool: 'taxiway', icon: '╱' },
  { tool: 'taxilane', icon: '┄' },
  { tool: 'rapidExit', icon: '⤷' },
  { tool: 'parallel', icon: '≡' },
  { tool: 'apron', icon: '▭' },
  { tool: 'stands', icon: '✈' },
  { tool: 'gaBlock', icon: '▦' },
  { tool: 'demolish', icon: '✕' },
];

interface Props {
  onUndo(): void;
  onRedo(): void;
}

/** Left rail with the build tools and undo and redo. */
export function ToolRail({ onUndo, onRedo }: Props) {
  const tool = useToolStore((s) => s.tool);
  const set = useToolStore((s) => s.set);
  const canUndo = useGameStore((s) => s.canUndo);
  const canRedo = useGameStore((s) => s.canRedo);
  return (
    <div
      data-testid="tool-rail"
      style="position:absolute;left:8px;top:236px;display:flex;flex-direction:column;gap:3px;padding:5px;background:#10161ce6;border:1px solid #2c3a45;border-radius:6px"
    >
      {TOOLS.map((x) => (
        <button
          key={x.tool}
          data-testid={`tool-${x.tool}`}
          title={tDynamic(`tool.${x.tool}`)}
          aria-label={tDynamic(`tool.${x.tool}`)}
          aria-pressed={tool === x.tool}
          onClick={() => set({ tool: x.tool, selection: null, hint: null, problem: null, buy: null })}
          style={`width:34px;height:30px;padding:0;font-size:15px;${tool === x.tool ? 'background:#2d6cdf;color:#fff' : ''}`}
        >
          {x.icon}
        </button>
      ))}
      <div style="display:flex;gap:3px;margin-top:4px">
        <button data-testid="undo" title={t('tool.undo')} aria-label={t('tool.undo')} disabled={!canUndo} onClick={onUndo} style="width:34px;height:28px;padding:0">
          ↶
        </button>
        <button data-testid="redo" title={t('tool.redo')} aria-label={t('tool.redo')} disabled={!canRedo} onClick={onRedo} style="width:34px;height:28px;padding:0">
          ↷
        </button>
      </div>
    </div>
  );
}
