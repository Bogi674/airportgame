import { useEffect, useState } from 'preact/hooks';
import { PRESETS, type Preset } from '@shared/site';
import { formatMoney } from './format';
import { deleteSave, listSaves, storageAvailable, type SaveHeader } from './saves';
import { t, tDynamic } from './strings';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomSeed(): string {
  // UI only, so Math.random is fine here. The sim never sees it.
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${s}-${Math.floor(1000 + Math.random() * 9000)}`;
}

interface Props {
  onStart(seed: string, preset: Preset): void;
  onLoad(id: string): void;
  onImport(file: File): void;
  autosave: boolean;
  onAutosave(on: boolean): void;
  error: string | null;
}

type View = 'main' | 'new' | 'load' | 'settings';

const PRESET_BLURB: Record<Preset, string> = {
  flatCoastal: 'Low land by the sea, easy grading.',
  riverValley: 'A river runs through gentle hills.',
};

/** Main menu, new game wizard, load screen and settings. */
export function Menu({ onStart, onLoad, onImport, autosave, onAutosave, error }: Props) {
  const [view, setView] = useState<View>('main');
  const [seed, setSeed] = useState('GOLDEN-0001');
  const [preset, setPreset] = useState<Preset>('flatCoastal');
  const [saves, setSaves] = useState<SaveHeader[]>([]);
  const [storage, setStorage] = useState(true);

  const refresh = (): void => {
    void listSaves().then(setSaves);
  };
  useEffect(() => {
    refresh();
    void storageAvailable().then(setStorage);
  }, []);

  const card = 'width:min(520px,92vw);padding:22px 26px;background:#10161cf2;border:1px solid #2c3a45;border-radius:10px;display:flex;flex-direction:column;gap:12px';
  return (
    <div data-testid="menu" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 20%,#1d3a52,#0b0f14 70%);z-index:50">
      <div style={card}>
        <div>
          <div style="font-size:28px;font-weight:700">{t('menu.title')}</div>
          <div style="color:#9fb4c4">{t('menu.tagline')}</div>
        </div>
        {error && (
          <div role="alert" style="color:#ffb4ad">
            {error}
          </div>
        )}
        {!storage && <div style="color:#ffcf8f;font-size:12px">{t('menu.storageBlocked')}</div>}
        {view === 'main' && (
          <>
            {saves.length > 0 && (
              <button data-testid="menu-continue" onClick={() => onLoad(saves[0].id)} style="padding:10px">
                {t('menu.continue')}
              </button>
            )}
            <button data-testid="menu-new" onClick={() => setView('new')} style="padding:10px">
              {t('menu.new')}
            </button>
            <button data-testid="menu-load" onClick={() => setView('load')} style="padding:10px">
              {t('menu.load')}
            </button>
            <button data-testid="menu-settings" onClick={() => setView('settings')} style="padding:10px">
              {t('menu.settings')}
            </button>
            <div style="color:#7d909f;font-size:12px">{t('menu.offline')}</div>
          </>
        )}
        {view === 'new' && (
          <>
            <label style="display:flex;flex-direction:column;gap:4px">
              {t('site.seed')}
              <div style="display:flex;gap:6px">
                <input aria-label={t('site.seed')} data-testid="seed" value={seed} style="flex:1" onInput={(e) => setSeed((e.target as HTMLInputElement).value)} />
                <button onClick={() => setSeed(randomSeed())}>{t('site.shuffle')}</button>
              </div>
              <span style="color:#7d909f;font-size:12px">{t('menu.seedHint')}</span>
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              {PRESETS.map((p) => (
                <button key={p} data-testid={`preset-${p}`} aria-pressed={preset === p} onClick={() => setPreset(p)} style={`text-align:left;padding:10px;${preset === p ? 'outline:2px solid #2d6cdf' : ''}`}>
                  <div style="font-weight:600">{tDynamic(`site.preset.${p}`)}</div>
                  <div style="font-size:12px;color:#9fb4c4">{PRESET_BLURB[p]}</div>
                </button>
              ))}
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button onClick={() => setView('main')}>{t('menu.back')}</button>
              <button data-testid="menu-start" style="padding:8px 18px" onClick={() => onStart(seed.trim() || 'GOLDEN-0001', preset)}>
                {t('menu.start')}
              </button>
            </div>
          </>
        )}
        {view === 'load' && (
          <>
            {saves.length === 0 && <div>{t('menu.noSaves')}</div>}
            <div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow:auto">
              {saves.map((s) => (
                <div key={s.id} data-testid="save-row" style="display:flex;gap:8px;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid #2c3a45;border-radius:6px">
                  <span style="font-size:13px">
                    {s.name}
                    <span style="color:#7d909f"> {formatMoney(s.cash)}</span>
                  </span>
                  <span style="display:flex;gap:6px">
                    <button onClick={() => onLoad(s.id)}>{t('save.load')}</button>
                    <button
                      onClick={() => {
                        void deleteSave(s.id).then(refresh);
                      }}
                    >
                      {t('save.delete')}
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <label style="display:flex;gap:8px;align-items:center">
              {t('menu.import')}
              <input
                data-testid="import-file"
                type="file"
                accept=".airfield,.json"
                onChange={(e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (f) onImport(f);
                }}
              />
            </label>
            <div style="display:flex;justify-content:flex-end">
              <button onClick={() => setView('main')}>{t('menu.back')}</button>
            </div>
          </>
        )}
        {view === 'settings' && (
          <>
            <label style="display:flex;gap:8px;align-items:center">
              <input data-testid="opt-autosave" type="checkbox" checked={autosave} onChange={(e) => onAutosave((e.target as HTMLInputElement).checked)} />
              {t('menu.autosave')}
            </label>
            <div style="display:flex;justify-content:flex-end">
              <button onClick={() => setView('main')}>{t('menu.back')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
