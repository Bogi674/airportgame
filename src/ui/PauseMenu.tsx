import { useState } from 'preact/hooks';
import { useGameStore } from './stores/gameStore';
import { Settings } from './Settings';
import { t } from './strings';

interface Props {
  onResume(): void;
  onSave(): void;
  onSaveAs(name: string): void;
  onLoad(): void;
  onExport(): void;
  onExit(): void;
  autosave: boolean;
  onAutosave(on: boolean): void;
  saved: boolean;
  /** The name Save as offers first. */
  defaultName: string;
}

/** Pause menu (T35): resume, save into the current slot, save as a new named slot, load, settings, export and exit. */
export function PauseMenu({ onResume, onSave, onSaveAs, onLoad, onExport, onExit, autosave, onAutosave, saved, defaultName }: Props) {
  const open = useGameStore((s) => s.pauseOpen);
  const [view, setView] = useState<'main' | 'saveAs' | 'settings'>('main');
  const [name, setName] = useState('');
  if (!open) return null;
  return (
    <div data-testid="pause-menu" role="dialog" aria-label={t('pause.title')} style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bg) 60%,transparent);z-index:40;padding:16px;box-sizing:border-box">
      <div style={`width:${view === 'settings' ? 'min(460px,100%)' : 'min(300px,100%)'};max-height:100%;overflow:auto;padding:18px;background:var(--surface);border:1px solid var(--line);border-radius:10px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box`}>
        <strong style="font-size:16px">{view === 'settings' ? t('pause.settings') : t('pause.title')}</strong>
        {view === 'main' && (
          <>
            <button data-testid="pause-resume" onClick={onResume}>
              {t('pause.resume')}
            </button>
            <button data-testid="pause-save" onClick={onSave}>
              {t('pause.save')}
            </button>
            <button
              data-testid="pause-save-as"
              onClick={() => {
                setName(defaultName);
                setView('saveAs');
              }}
            >
              {t('pause.saveAs')}
            </button>
            <button data-testid="pause-load" onClick={onLoad}>
              {t('pause.load')}
            </button>
            <button data-testid="pause-settings" onClick={() => setView('settings')}>
              {t('pause.settings')}
            </button>
            <button data-testid="pause-export" onClick={onExport}>
              {t('pause.export')}
            </button>
            <button data-testid="pause-exit" onClick={onExit}>
              {t('pause.exit')}
            </button>
          </>
        )}
        {view === 'saveAs' && (
          <form
            style="display:flex;flex-direction:column;gap:8px"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim();
              if (!n) return;
              onSaveAs(n);
              setView('main');
            }}
          >
            <label style="display:flex;flex-direction:column;gap:4px">
              {t('save.nameLabel')}
              <input data-testid="save-as-name" value={name} maxLength={60} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </label>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button type="button" onClick={() => setView('main')}>
                {t('menu.back')}
              </button>
              <button type="submit" data-testid="save-as-confirm">
                {t('pause.saveAsConfirm')}
              </button>
            </div>
          </form>
        )}
        {view === 'settings' && <Settings autosave={autosave} onAutosave={onAutosave} onBack={() => setView('main')} />}
        {saved && <div style="color: var(--good-text);font-size:12px">{t('pause.saved')}</div>}
      </div>
    </div>
  );
}
