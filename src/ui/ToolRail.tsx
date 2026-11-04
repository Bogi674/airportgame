import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { CATEGORIES, openCategory } from './BuildMenu';
import { Icon } from './icons';
import { t, tDynamic } from './strings';

interface Props {
  onUndo(): void;
  onRedo(): void;
}

/** Left toolbar: one tile per build category, then select, demolish, undo and redo. A category opens its menu at the bottom. */
export function ToolRail({ onUndo, onRedo }: Props) {
  const s = useToolStore();
  const canUndo = useGameStore((g) => g.canUndo);
  const canRedo = useGameStore((g) => g.canRedo);
  const plain = (tool: 'select' | 'demolish'): void =>
    s.set({ tool, category: null, menuOpen: false, selection: null, hint: null, problem: null, buy: null, barOpen: true });
  return (
    <div data-testid="tool-rail" class="panel rail">
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          class="round"
          data-testid={c.testId}
          title={tDynamic(`menu.${c.id}`)}
          aria-label={tDynamic(`menu.${c.id}`)}
          aria-pressed={s.category === c.id && s.menuOpen}
          onClick={() => openCategory(c)}
        >
          <Icon name={c.icon} size={20} />
        </button>
      ))}
      <div class="sep" />
      <button class="round small" data-testid="tool-select" title={tDynamic('tool.select')} aria-label={tDynamic('tool.select')} aria-pressed={s.tool === 'select'} onClick={() => plain('select')}>
        <Icon name="select" size={16} />
        <span class="kbd">V</span>
      </button>
      <button class="round small" data-testid="tool-demolish" title={tDynamic('tool.demolish')} aria-label={tDynamic('tool.demolish')} aria-pressed={s.tool === 'demolish'} onClick={() => plain('demolish')}>
        <Icon name="demolish" size={16} />
        <span class="kbd">X</span>
      </button>
      <button class="round small" data-testid="undo" title={t('tool.undo')} aria-label={t('tool.undo')} disabled={!canUndo} onClick={onUndo}>
        <Icon name="undo" size={15} />
      </button>
      <button class="round small" data-testid="redo" title={t('tool.redo')} aria-label={t('tool.redo')} disabled={!canRedo} onClick={onRedo}>
        <Icon name="redo" size={15} />
      </button>
    </div>
  );
}
