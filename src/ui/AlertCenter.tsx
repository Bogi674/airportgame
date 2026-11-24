import { useGameStore, type AlertSeverity } from './stores/gameStore';
import { Icon } from './icons';
import { t, tFormat } from './strings';
import { formatClock } from './format';

const GROUPS: AlertSeverity[] = ['critical', 'warning', 'info'];
const TONE: Record<AlertSeverity, string> = { critical: 'var(--bad)', warning: 'var(--warn)', info: 'var(--accent)' };

/**
 * The bell in the top bar and its alert center (T36): alerts grouped by severity, repeats merged with a count, a jump to the
 * stand. The panel hangs from the right edge under the top bar, clear of the decision card and toasts in the centre column.
 */
export function AlertCenter({ onJump }: { onJump(stand: string): void }) {
  const log = useGameStore((s) => s.alertLog);
  const unread = useGameStore((s) => s.unread);
  const open = useGameStore((s) => s.alertsOpen);
  const toggle = useGameStore((s) => s.toggleAlerts);
  const clear = useGameStore((s) => s.clearAlertLog);
  return (
    <span style="position:relative;display:inline-flex">
      <button class="round" data-testid="alert-bell" title={t('alerts.title')} aria-label={unread > 0 ? tFormat('alerts.unread', { n: unread }) : t('alerts.title')} aria-expanded={open} onClick={toggle}>
        <Icon name="bell" size={16} />
        {unread > 0 && (
          <span data-testid="alert-unread" style="position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:var(--bad);color:var(--panel-solid);font-size:10px;line-height:16px;text-align:center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div class="panel" data-testid="alert-center" role="dialog" aria-label={t('alerts.title')} style="position:fixed;right:12px;top:72px;width:min(360px,calc(100vw - 32px));max-height:60vh;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px;z-index:30;box-sizing:border-box">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div class="section">{t('alerts.title')}</div>
            {log.length > 0 && (
              <button data-testid="alert-clear" onClick={clear}>
                {t('alerts.clear')}
              </button>
            )}
          </div>
          {log.length === 0 && <div style="color:var(--muted);font-size:12px">{t('alerts.empty')}</div>}
          {GROUPS.map((g) => {
            const rows = log.filter((a) => a.severity === g);
            if (rows.length === 0) return null;
            return (
              <section key={g} data-testid={`alert-group-${g}`} style="display:flex;flex-direction:column;gap:6px">
                <span style={`font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:600;color:${TONE[g]}`}>{t(`alerts.${g}`)}</span>
                {rows.map((a) => (
                  <div key={a.id} data-testid="alert-row" style={`display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border:1px solid var(--line);border-left:3px solid ${TONE[g]};border-radius:8px`}>
                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
                      <span style="font-size:12px;line-height:1.35">{a.text}</span>
                      <span style="font-size:11px;color:var(--muted)">
                        {formatClock(a.tick)}
                        {a.count > 1 ? `, ${tFormat('alerts.count', { n: a.count })}` : ''}
                      </span>
                    </div>
                    {a.stand !== null && (
                      <button data-testid="alert-jump" style="flex:none" onClick={() => onJump(a.stand ?? '')}>
                        {t('alerts.jump')}
                      </button>
                    )}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </span>
  );
}
