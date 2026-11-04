import { useGameStore } from './stores/gameStore';
import { t } from './strings';

interface Props {
  onResume(): void;
  onSave(): void;
  onExport(): void;
  onExit(): void;
  saved: boolean;
}

export function PauseMenu({ onResume, onSave, onExport, onExit, saved }: Props) {
  const open = useGameStore((s) => s.pauseOpen);
  if (!open) return null;
  return (
    <div data-testid="pause-menu" role="dialog" aria-label={t('pause.title')} style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0008;z-index:40">
      <div style="width:300px;padding:18px;background:var(--panel);border:1px solid var(--line);border-radius:10px;display:flex;flex-direction:column;gap:8px">
        <strong style="font-size:16px">{t('pause.title')}</strong>
        <button data-testid="pause-resume" onClick={onResume}>
          {t('pause.resume')}
        </button>
        <button data-testid="pause-save" onClick={onSave}>
          {t('pause.save')}
        </button>
        <button data-testid="pause-export" onClick={onExport}>
          {t('pause.export')}
        </button>
        <button data-testid="pause-exit" onClick={onExit}>
          {t('pause.exit')}
        </button>
        {saved && <div style="color:var(--ok);font-size:12px">{t('pause.saved')}</div>}
      </div>
    </div>
  );
}
