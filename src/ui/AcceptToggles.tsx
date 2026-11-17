import { acceptBit, FLIGHT_CATEGORIES, type Stand } from '@shared/airfield';
import type { Command } from '@sim/commands';
import { t, tDynamic } from './strings';

/**
 * The GA, commercial and cargo toggles of a stand (user, 2026-11-17). Any mix is allowed, but the last
 * category that is on cannot be switched off, so a stand always takes at least one kind of flight.
 */
export function AcceptToggles({ stand, send }: { stand: Stand; send(cmd: Command): void }) {
  return (
    <span style="display:inline-flex;gap:6px;flex-wrap:wrap" title={t('stands.acceptsTip')}>
      {FLIGHT_CATEGORIES.map((c) => {
        const bit = acceptBit(c);
        const on = (stand.accepts & bit) !== 0;
        const last = on && stand.accepts === bit;
        return (
          <label key={c} class="switch">
            <input
              data-testid={`stand-accepts-${c}-${stand.id}`}
              type="checkbox"
              checked={on}
              disabled={last}
              onChange={() => send({ type: 'setStandProps', id: stand.id, accepts: stand.accepts ^ bit })}
            />
            <span>{tDynamic(`stands.accepts.${c}`)}</span>
          </label>
        );
      })}
    </span>
  );
}
