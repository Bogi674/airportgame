import { useGameStore } from './stores/gameStore';
import { noticeText } from './strings';
import type { Command } from '@sim/commands';
import { EventCard } from './EventCard';

/** The open event decision, notices for refused actions and the latest alerts, stacked below the top bar. */
export function Toasts({ send }: { send: (c: Command) => void }) {
  const alerts = useGameStore((s) => s.alerts);
  const notice = useGameStore((s) => s.notice);
  const dismiss = useGameStore((s) => s.dismissAlert);
  const shown = alerts.slice(-4);
  return (
    <div data-testid="toasts" style="position:absolute;left:50%;transform:translateX(-50%);top:104px;display:flex;flex-direction:column;gap:4px;max-width:420px;z-index:10">
      <EventCard send={send} />
      {notice && (
        <div role="alert" data-testid="notice" style="padding:6px 10px;background:var(--surface);border:1px solid var(--bad);border-radius:10px;font-size:12px">
          {noticeText(notice.code, notice.args)}
        </div>
      )}
      {shown.map((a) => (
        <div
          key={a.id}
          data-testid="alert"
          style={`padding:6px 10px;border-radius:10px;font-size:12px;display:flex;gap:8px;justify-content:space-between;background:${a.tone === 'warn' ? 'var(--surface)' : 'var(--surface)'};border:1px solid ${a.tone === 'warn' ? 'var(--warn)' : 'var(--accent)'}`}
        >
          <span>{a.text}</span>
          <button aria-label="Dismiss" style="padding:0 6px" onClick={() => dismiss(a.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
