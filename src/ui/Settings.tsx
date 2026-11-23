import { useState } from 'preact/hooks';
import { useGameStore } from './stores/gameStore';
import { t, tDynamic } from './strings';
import { currentTheme, reducedMotion, setReducedMotion, setTheme, type Theme } from './theme';

const QUALITIES = ['auto', 'low', 'medium', 'high'] as const;
const THEMES: Theme[] = ['dark', 'light'];

interface Props {
  autosave: boolean;
  onAutosave(on: boolean): void;
  onBack(): void;
}

/** Settings in three groups (T35): display, gameplay and accessibility. Changes apply at once. */
export function Settings({ autosave, onAutosave, onBack }: Props) {
  const quality = useGameStore((s) => s.quality);
  const setQuality = useGameStore((s) => s.setQuality);
  const [theme, setThemeState] = useState<Theme>(currentTheme());
  const [motion, setMotion] = useState(reducedMotion());
  const group = 'display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--line);border-radius:10px';
  const seg = (on: boolean): string => `flex:1;padding:6px 8px;${on ? 'outline:2px solid var(--accent)' : ''}`;
  return (
    <div data-testid="settings" style="display:flex;flex-direction:column;gap:10px">
      <section style={group} aria-label={t('settings.display')}>
        <strong>{t('settings.display')}</strong>
        <span style="color:var(--muted);font-size:12px">{t('settings.quality')}</span>
        <div style="display:flex;gap:6px">
          {QUALITIES.map((q) => (
            <button key={q} data-testid={`opt-quality-${q}`} aria-pressed={quality === q} style={seg(quality === q)} onClick={() => setQuality(q)}>
              {tDynamic(`settings.quality.${q}`)}
            </button>
          ))}
        </div>
        <span style="color:var(--muted);font-size:12px">{t('settings.theme')}</span>
        <div style="display:flex;gap:6px">
          {THEMES.map((th) => (
            <button
              key={th}
              data-testid={`opt-theme-${th}`}
              aria-pressed={theme === th}
              style={seg(theme === th)}
              onClick={() => {
                setTheme(th);
                setThemeState(th);
              }}
            >
              {tDynamic(`settings.theme.${th}`)}
            </button>
          ))}
        </div>
      </section>
      <section style={group} aria-label={t('settings.gameplay')}>
        <strong>{t('settings.gameplay')}</strong>
        <label style="display:flex;gap:8px;align-items:center">
          <input data-testid="opt-autosave" type="checkbox" checked={autosave} onChange={(e) => onAutosave((e.target as HTMLInputElement).checked)} />
          {t('menu.autosave')}
        </label>
      </section>
      <section style={group} aria-label={t('settings.access')}>
        <strong>{t('settings.access')}</strong>
        <label style="display:flex;gap:8px;align-items:center">
          <input
            data-testid="opt-motion"
            type="checkbox"
            checked={motion}
            onChange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              setReducedMotion(on);
              setMotion(on);
            }}
          />
          {t('settings.motion')}
        </label>
      </section>
      <div style="display:flex;justify-content:flex-end">
        <button data-testid="settings-back" onClick={onBack}>
          {t('menu.back')}
        </button>
      </div>
    </div>
  );
}
