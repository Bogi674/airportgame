import { useGameStore, type Sheet } from './stores/gameStore';
import { useToolStore } from './stores/toolStore';
import { CATEGORIES, openCategory } from './BuildMenu';
import { Icon, type IconName } from './icons';
import { OverlayMenu } from './OverlayMenu';
import { t, type StringKey } from './strings';

/** Width under which the task bar shows icons only, labels moving into tooltips (design revision 6 section 4.3). */
export const NARROW_PX = 1360;

/**
 * Task bar of design revision 6 section 5.7: the modes Select, Build and Land, the management sheets, and Overlays.
 * The active item is a mini primary button. A sheet opens from the left and hides the build flyout.
 */
export function TaskBar() {
  const tool = useToolStore();
  const g = useGameStore();
  const building = tool.tool !== 'select' && tool.tool !== 'demolish';
  const mode: 'select' | 'build' | 'land' | null = g.parcelOverlay ? 'land' : g.sheet ? null : building || tool.menuOpen ? 'build' : tool.tool === 'select' ? 'select' : null;
  const item = (id: string, icon: IconName, key: StringKey, on: boolean, run: () => void, disabled = false) => (
    <button key={id} class={`tb${on ? ' on' : ''}`} data-testid={`task-${id}`} aria-pressed={on} title={disabled ? `${t(key)}: ${t('rail.later')}` : t(key)} aria-label={t(key)} disabled={disabled} onClick={run}>
      <Icon name={icon} size={16} />
      <span class="tb-l">{t(key)}</span>
    </button>
  );
  const leaveLand = (): void => {
    if (useGameStore.getState().parcelOverlay) useGameStore.getState().toggleParcelOverlay();
  };
  const sheet = (id: Exclude<Sheet, null>, icon: IconName, key: StringKey) =>
    item(id, icon, key, g.sheet === id, () => {
      leaveLand();
      g.setSheet(g.sheet === id ? null : id);
    });
  return (
    <div class="pn taskbar z-task" data-testid="task-bar" role="toolbar" aria-label={t('task.label')}>
      {item('select', 'select', 'task.select', mode === 'select', () => {
        leaveLand();
        g.setSheet(null);
        tool.set({ tool: 'select', category: null, menuOpen: false, selection: null, hint: null, problem: null, buy: null, barOpen: true });
      })}
      {item('build', 'build', 'task.build', mode === 'build', () => {
        leaveLand();
        g.setSheet(null);
        const last = CATEGORIES.find((c) => c.id === tool.category) ?? CATEGORIES[0];
        if (!tool.menuOpen) openCategory(last);
      })}
      {item('land', 'land', 'task.land', mode === 'land', () => {
        g.setSheet(null);
        g.toggleParcelOverlay();
      })}
      <span class="tb-sep" />
      {sheet('airlines', 'airlines', 'task.airlines')}
      {sheet('flights', 'flights', 'task.flights')}
      {sheet('finance', 'finance', 'task.finance')}
      {sheet('staff', 'staff', 'task.staff')}
      {sheet('tenants', 'tenants', 'task.tenants')}
      {item('reports', 'reports', 'task.reports', false, () => undefined, true)}
      <span class="tb-sep" />
      <span style="position:relative;display:inline-flex" data-pop-anchor="overlays">
        <button class={`tb${g.overlayMenuOpen || g.overlay !== 'none' ? ' on' : ''}`} data-testid="overlay-menu" aria-haspopup="menu" aria-expanded={g.overlayMenuOpen} aria-pressed={g.overlay !== 'none'} title={t('task.overlays')} aria-label={t('task.overlays')} onClick={g.toggleOverlayMenu}>
          <Icon name="overlay" size={16} />
          <span class="tb-l">{t('task.overlays')}</span>
        </button>
        {g.overlayMenuOpen && <OverlayMenu up />}
      </span>
    </div>
  );
}
