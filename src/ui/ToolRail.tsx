import { useGameStore } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { CATEGORIES, openCategory, type Category } from './BuildMenu';
import { Icon } from './icons';
import { t, tDynamic } from './strings';
import type { Group } from './kit';

interface Props {
  onUndo(): void;
  onRedo(): void;
}

/** Rail groups in order (UI revision 6 section 5.4). The tools group holds zoning and bulldoze, then undo and redo follow. */
const GROUPS: readonly Group[] = ['air', 'trm', 'ops', 'tool'];

/**
 * Left rail of UI revision 6 section 5.4: one 36 by 32 button per build category, grouped by color, then bulldoze,
 * undo and redo. The active category is filled in its group color; a locked one is dimmed and says it comes later.
 */
export function ToolRail({ onUndo, onRedo }: Props) {
  const s = useToolStore();
  const canUndo = useGameStore((g) => g.canUndo);
  const canRedo = useGameStore((g) => g.canRedo);
  const bulldoze = s.tool === 'demolish';
  const btn = (c: Category) => {
    const name = tDynamic(`menu.${c.id}`);
    const tip = c.locked ? `${name}: ${t('rail.later')}` : c.id === 'bulldoze' ? `${name} (X)` : name;
    return (
      <button
        key={c.id}
        class={`rb g-${c.id === 'bulldoze' && bulldoze ? 'bad' : c.group}${c.locked ? ' locked' : ''}`}
        data-testid={c.testId}
        title={tip}
        aria-label={tip}
        aria-disabled={c.locked || undefined}
        aria-pressed={(s.category === c.id && s.menuOpen) || (c.id === 'bulldoze' && bulldoze)}
        onClick={() => openCategory(c)}
      >
        <Icon name={c.icon} size={17} />
      </button>
    );
  };
  return (
    <div data-testid="tool-rail" class="pn rail z-rail">
      {GROUPS.map((g, i) => (
        <div key={g} class="rail-group">
          {i > 0 && <div class="rail-sep" />}
          {CATEGORIES.filter((c) => c.group === g).map(btn)}
        </div>
      ))}
      <button class="rb g-tool" data-testid="undo" title={`${t('tool.undo')} (Ctrl Z)`} aria-label={t('tool.undo')} disabled={!canUndo} onClick={onUndo}>
        <Icon name="undo" size={16} />
      </button>
      <button class="rb g-tool" data-testid="redo" title={`${t('tool.redo')} (Ctrl Y)`} aria-label={t('tool.redo')} disabled={!canRedo} onClick={onRedo}>
        <Icon name="redo" size={16} />
      </button>
    </div>
  );
}
