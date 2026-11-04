import { useState } from 'preact/hooks';
import { useGameStore } from './stores/gameStore';
import { t } from './strings';

interface Props {
  onMenu(): void;
}

/** Shown when the sim stops. The report holds what is needed to replay the bug: version, browser, seed and the last commands. */
export function CrashPanel({ onMenu }: Props) {
  const crash = useGameStore((s) => s.crash);
  const [copied, setCopied] = useState(false);
  if (!crash) return null;
  const report = JSON.stringify(
    {
      game: 'Airfield Tycoon',
      version: '0.1',
      browser: navigator.userAgent,
      error: crash.message,
      tick: crash.tick,
      seed: crash.seed,
      lastCommands: crash.commands,
    },
    null,
    1,
  );
  const copy = (): void => {
    void navigator.clipboard
      .writeText(report)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <div data-testid="crash-panel" role="alertdialog" class="panel" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(460px,92vw);padding:16px 18px;z-index:80;display:flex;flex-direction:column;gap:10px">
      <div class="sheet-title">{t('crash.title')}</div>
      <div style="font-size:13px;color:var(--muted)">{t('crash.body')}</div>
      <code style="font-size:11px;word-break:break-word;color:var(--bad)">{crash.message}</code>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button data-testid="crash-menu" onClick={onMenu}>
          {t('crash.menu')}
        </button>
        <button data-testid="crash-copy" onClick={copy}>
          {copied ? t('crash.copied') : t('crash.copy')}
        </button>
        <button data-testid="crash-reload" onClick={() => location.reload()}>
          {t('error.restart')}
        </button>
      </div>
    </div>
  );
}
