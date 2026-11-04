import { useGameStore } from './stores/gameStore';
import { useToolStore, type Tool } from './stores/toolStore';
import { Icon, type IconName } from './icons';
import { t, tDynamic } from './strings';

const TOOLS: { tool: Tool; icon: IconName; key: string }[] = [
  { tool: 'select', icon: 'select', key: 'V' },
  { tool: 'runway', icon: 'runway', key: '' },
  { tool: 'taxiway', icon: 'taxiway', key: '' },
  { tool: 'taxilane', icon: 'taxilane', key: '' },
  { tool: 'rapidExit', icon: 'rapidExit', key: '' },
  { tool: 'parallel', icon: 'parallel', key: '' },
  { tool: 'apron', icon: 'apron', key: '' },
  { tool: 'stands', icon: 'stands', key: '' },
  { tool: 'gaBlock', icon: 'gaBlock', key: '' },
  { tool: 'terminal', icon: 'terminal', key: '' },
  { tool: 'demolish', icon: 'demolish', key: 'X' },
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
    <div data-testid="tool-rail" class="panel rail">
      <div class="section" style="margin:0 0 2px;text-align:center;border:0;white-space:nowrap;letter-spacing:0.1em">{t('rail.build')}</div>
      {TOOLS.map((x) => (
        <button
          key={x.tool}
          class="round"
          data-testid={`tool-${x.tool}`}
          title={tDynamic(`tool.${x.tool}`)}
          aria-label={tDynamic(`tool.${x.tool}`)}
          aria-pressed={tool === x.tool}
          onClick={() => set({ tool: x.tool, selection: null, hint: null, problem: null, buy: null })}
        >
          <Icon name={x.icon} />
          {x.key && <span class="kbd">{x.key}</span>}
        </button>
      ))}
      <div class="sep" />
      <div style="display:flex;gap:6px;justify-content:center">
        <button class="round" style="width:30px;height:30px" data-testid="undo" title={t('tool.undo')} aria-label={t('tool.undo')} disabled={!canUndo} onClick={onUndo}>
          <Icon name="undo" size={15} />
        </button>
        <button class="round" style="width:30px;height:30px" data-testid="redo" title={t('tool.redo')} aria-label={t('tool.redo')} disabled={!canRedo} onClick={onRedo}>
          <Icon name="redo" size={15} />
        </button>
      </div>
    </div>
  );
}
