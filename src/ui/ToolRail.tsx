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
  const barOpen = useToolStore((s) => s.barOpen);
  const pick = (next: Tool): void => {
    if (tool === next && next !== 'select') set({ barOpen: !barOpen });
    else set({ tool: next, barOpen: true, selection: null, hint: null, problem: null, buy: null });
  };
  return (
    <div data-testid="tool-rail" class="panel rail">
      {TOOLS.map((x) => (
        <button
          key={x.tool}
          class="round"
          data-testid={`tool-${x.tool}`}
          title={tDynamic(`tool.${x.tool}`)}
          aria-label={tDynamic(`tool.${x.tool}`)}
          aria-pressed={tool === x.tool}
          onClick={() => pick(x.tool)}
        >
          <Icon name={x.icon} />
          {x.key && <span class="kbd">{x.key}</span>}
        </button>
      ))}
      <div class="sep" />
      <button class="round" data-testid="toggle-options" title={t('tool.options')} aria-label={t('tool.options')} aria-pressed={barOpen && tool !== 'select'} disabled={tool === 'select'} onClick={() => set({ barOpen: !barOpen })}>
        <Icon name="options" />
      </button>
      <button class="round" data-testid="undo" title={t('tool.undo')} aria-label={t('tool.undo')} disabled={!canUndo} onClick={onUndo}>
        <Icon name="undo" size={16} />
      </button>
      <button class="round" data-testid="redo" title={t('tool.redo')} aria-label={t('tool.redo')} disabled={!canRedo} onClick={onRedo}>
        <Icon name="redo" size={16} />
      </button>
    </div>
  );
}
