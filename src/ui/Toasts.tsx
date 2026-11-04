import { useGameStore } from './stores/gameStore';
import { noticeText } from './strings';

/** Notices for refused actions and the latest alerts, bottom left above the tool bar. */
export function Toasts() {
  const alerts = useGameStore((s) => s.alerts);
  const notice = useGameStore((s) => s.notice);
  const dismiss = useGameStore((s) => s.dismissAlert);
  const shown = alerts.slice(-4);
  return (
    <div data-testid="toasts" style="position:absolute;left:50%;transform:translateX(-50%);top:104px;display:flex;flex-direction:column;gap:4px;max-width:420px;z-index:10">
      {notice && (
        <div role="alert" data-testid="notice" style="padding:6px 10px;background:var(--panel);border:1px solid var(--bad);border-radius:10px;font-size:12px">
          {noticeText(notice.code, notice.args)}
        </div>
      )}
      {shown.map((a) => (
        <div
          key={a.id}
          data-testid="alert"
          style={`padding:6px 10px;border-radius:10px;font-size:12px;display:flex;gap:8px;justify-content:space-between;background:${a.tone === 'warn' ? 'var(--panel)' : 'var(--panel)'};border:1px solid ${a.tone === 'warn' ? 'var(--warn)' : 'var(--accent)'}`}
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
