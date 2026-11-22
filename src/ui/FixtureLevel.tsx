import { TICKS_PER_DAY, type FixtureKey, type TerminalGrid } from '@shared/business';
import { isLeveled, MAX_FIXTURE_LEVEL, upgradeCost, upgradeDays } from '@shared/fixtureLevels';
import { cellOf, fixtureAnchor } from '@shared/terminalOps';
import type { Command } from '@sim/commands';
import { formatMoney } from './format';
import { useGameStore } from './stores/gameStore';
import { t, tDynamic, tFormat } from './strings';

interface Props {
  grid: TerminalGrid;
  cell: number;
  name: FixtureKey;
  send: (cmd: Command) => void;
}

/** Level of a leveled fixture in the inspector, with its upgrade button, or the running works and their cancel button (T74). */
export function FixtureLevel({ grid, cell, name, send }: Props) {
  const tick = useGameStore((st) => st.tick);
  const cash = useGameStore((st) => st.cash);
  if (!isLeveled(name)) return null;
  const anchor = fixtureAnchor(grid, cell);
  if (anchor < 0) return null;
  const at = cellOf(grid, anchor);
  const level = grid.fixtureLevel[anchor];
  const works = grid.works?.find((w) => w.x === at.x && w.y === at.y);
  const cmd = { building: grid.id, x: at.x, y: at.y };
  return (
    <div data-testid="fixture-level-block" style="display:grid;gap:4px;margin-top:4px">
      <div data-testid="fixture-level">
        {tFormat('inspector.level', { n: level })}: {tDynamic(`opt.level.${name}.${level}`)}
      </div>
      {works ? (
        <div style="display:flex;justify-content:space-between;gap:6px;align-items:center">
          <span data-testid="fixture-works">{tFormat('inspector.fixtureWorks', { n: works.to, days: Math.max(0, Math.ceil((works.doneTick - tick) / TICKS_PER_DAY)) })}</span>
          <button data-testid="fixture-cancel-works" onClick={() => send({ type: 'cancelFixtureUpgrade', ...cmd })}>
            {tFormat('inspector.fixtureCancel', { cost: formatMoney(works.cost) })}
          </button>
        </div>
      ) : level < MAX_FIXTURE_LEVEL ? (
        <button
          data-testid="fixture-upgrade"
          disabled={cash < upgradeCost(name, level)}
          title={cash < upgradeCost(name, level) ? t('inspector.stand.upgradeNoCash') : undefined}
          onClick={() => send({ type: 'upgradeFixture', ...cmd })}
        >
          {tFormat('inspector.fixtureUpgrade', { name: tDynamic(`opt.level.${name}.${level + 1}`), cost: formatMoney(upgradeCost(name, level)), days: upgradeDays(name) })}
        </button>
      ) : (
        <div style="color:var(--muted);font-size:12px">{t('inspector.fixtureTop')}</div>
      )}
    </div>
  );
}
