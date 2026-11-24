import { useEffect, useState } from 'preact/hooks';
import type { AirportIdentity, GameMode } from '@shared/protocol';
import { PRESETS, type Preset, type SitePayload } from '@shared/site';
import pkg from '../../package.json';
import { BRAND_COLORS, codesFor } from './airportIdentity';
import { deleteSave, duplicateSave, listSaves, renameSave, storageAvailable, type SaveHeader } from './saves';
import { Settings } from './Settings';
import { SitePreview } from './SitePreview';
import { t, tDynamic, tFormat } from './strings';
import { formatClock, formatInt } from './format';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomSeed(): string {
  // UI only, so Math.random is fine here. The sim never sees it.
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${s}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export type MenuView = 'main' | 'new' | 'load' | 'settings' | 'credits';

interface Props {
  initialView: MenuView;
  onStart(seed: string, preset: Preset, mode: GameMode, airport: AirportIdentity): void;
  onLoad(save: SaveHeader): void;
  onImport(file: File): void;
  onPreview(seed: string, preset: Preset): void;
  preview: SitePayload | null;
  autosave: boolean;
  onAutosave(on: boolean): void;
  error: string | null;
}

const PRESET_BLURB: Record<Preset, string> = {
  flatCoastal: 'Low land by the sea, easy grading.',
  riverValley: 'A river runs through gentle hills.',
};

/** A default airport name from the seed: its letters before the dash, then the suffix. */
function defaultName(seed: string): string {
  const head = (seed.split('-')[0] ?? seed).replace(/[^A-Za-z]/g, '');
  const word = head.length > 0 ? head[0]!.toUpperCase() + head.slice(1).toLowerCase() : 'Field';
  return `${word} ${t('menu.airportSuffix')}`;
}

/** Saves grouped by career, newest career first; within a career the manual saves and the autosaves apart. */
function byCareer(saves: SaveHeader[]): { career: string; manual: SaveHeader[]; auto: SaveHeader[] }[] {
  const groups = new Map<string, { career: string; manual: SaveHeader[]; auto: SaveHeader[] }>();
  for (const s of saves) {
    const key = s.career ?? s.seed;
    let g = groups.get(key);
    if (!g) {
      g = { career: key, manual: [], auto: [] };
      groups.set(key, g);
    }
    (s.auto ? g.auto : g.manual).push(s);
  }
  return [...groups.values()];
}

/** Main menu over the demo airport, the two step new game panel, the load screen with save cards, settings and credits (T35). */
export function Menu({ initialView, onStart, onLoad, onImport, onPreview, preview, autosave, onAutosave, error }: Props) {
  const [view, setView] = useState<MenuView>(initialView);
  const [mode, setMode] = useState<GameMode>('career');
  const [step, setStep] = useState<1 | 2>(1);
  const [seed, setSeed] = useState('GOLDEN-0001');
  const [preset, setPreset] = useState<Preset>('flatCoastal');
  const [name, setName] = useState(defaultName('GOLDEN-0001'));
  const [nameEdited, setNameEdited] = useState(false);
  const [codes, setCodes] = useState(codesFor(defaultName('GOLDEN-0001')));
  const [codesEdited, setCodesEdited] = useState(false);
  const [color, setColor] = useState<string>(BRAND_COLORS[0]);
  const [saves, setSaves] = useState<SaveHeader[]>([]);
  const [storage, setStorage] = useState(true);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const refresh = (): void => {
    void listSaves().then(setSaves);
  };
  useEffect(() => {
    refresh();
    void storageAvailable().then(setStorage);
  }, []);
  useEffect(() => {
    if (view === 'new') onPreview(seed.trim() || 'GOLDEN-0001', preset);
  }, [view, seed, preset]);

  const changeSeed = (v: string): void => {
    setSeed(v);
    if (!nameEdited) {
      const n = defaultName(v);
      setName(n);
      if (!codesEdited) setCodes(codesFor(n));
    }
  };
  const openNew = (m: GameMode): void => {
    setMode(m);
    setStep(1);
    setView('new');
  };
  const start = (): void => onStart(seed.trim() || 'GOLDEN-0001', preset, mode, { name: name.trim() || defaultName(seed), iata: codes.iata, icao: codes.icao, color });

  const panel = 'padding:22px 26px;background:var(--panel);border:1px solid var(--line);border-radius:10px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box';
  const latest = saves[0];
  return (
    <div data-testid="menu" style="position:absolute;inset:0;background:color-mix(in srgb,var(--bg) 55%,transparent);z-index:50;overflow:auto">
      {view === 'main' && (
        <div style={`${panel};position:absolute;left:48px;top:50%;transform:translateY(-50%);width:280px;max-width:calc(100vw - 32px)`}>
          <div>
            <div style="font-size:28px;font-weight:700">{t('menu.title')}</div>
            <div style="color:var(--muted)">{t('menu.tagline')}</div>
          </div>
          {error && (
            <div role="alert" style="color:var(--bad)">
              {error}
            </div>
          )}
          {!storage && <div style="color:var(--warn);font-size:12px">{t('menu.storageBlocked')}</div>}
          {latest && (
            <button data-testid="menu-continue" onClick={() => onLoad(latest)} style="padding:8px;display:flex;gap:10px;align-items:center;text-align:left">
              {latest.thumb ? <img src={latest.thumb} alt="" width={64} height={40} style="border-radius:6px;flex:none;object-fit:cover" /> : null}
              <span style="display:flex;flex-direction:column;min-width:0">
                <b>{t('menu.continue')}</b>
                <span style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{tFormat('menu.continueFrom', { name: latest.name, date: formatClock(latest.tick) })}</span>
              </span>
            </button>
          )}
          <button data-testid="menu-new" onClick={() => openNew('career')} style="padding:10px">
            {t('menu.career')}
          </button>
          <button data-testid="menu-sandbox" onClick={() => openNew('sandbox')} style="padding:10px">
            {t('menu.sandbox')}
          </button>
          <button data-testid="menu-load" onClick={() => setView('load')} style="padding:10px">
            {t('menu.load')}
          </button>
          <button data-testid="menu-settings" onClick={() => setView('settings')} style="padding:10px">
            {t('menu.settings')}
          </button>
          <button data-testid="menu-credits" onClick={() => setView('credits')} style="padding:10px">
            {t('menu.credits')}
          </button>
          <div style="color:var(--muted);font-size:12px">{t('menu.offline')}</div>
          <div data-testid="menu-version" style="color:var(--muted);font-size:11px">{tFormat('menu.version', { v: pkg.version })}</div>
        </div>
      )}
      {view !== 'main' && (
        <div style="min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box">
          {view === 'new' && (
            <div data-testid="wizard" style={`${panel};width:min(660px,100%)`}>
              <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">
                <strong style="font-size:18px">{t(mode === 'sandbox' ? 'menu.newSandboxTitle' : 'menu.newCareerTitle')}</strong>
                <span style="display:flex;gap:12px;font-size:12px">
                  <span style={step === 1 ? 'color:var(--accent);font-weight:600' : 'color:var(--muted)'}>{t('menu.step.site')}</span>
                  <span style={step === 2 ? 'color:var(--accent);font-weight:600' : 'color:var(--muted)'}>{t('menu.step.airport')}</span>
                </span>
              </div>
              {mode === 'sandbox' && <div style="color:var(--muted);font-size:12px">{t('menu.sandboxHint')}</div>}
              {step === 1 && (
                <div style="display:flex;gap:16px;flex-wrap:wrap">
                  <div style="flex:1 1 280px;display:flex;flex-direction:column;gap:10px;min-width:0">
                    <label style="display:flex;flex-direction:column;gap:4px">
                      {t('site.seed')}
                      <div style="display:flex;gap:6px">
                        <input aria-label={t('site.seed')} data-testid="seed" value={seed} style="flex:1;min-width:0" onInput={(e) => changeSeed((e.target as HTMLInputElement).value)} />
                        <button data-testid="seed-shuffle" onClick={() => changeSeed(randomSeed())}>
                          {t('site.shuffle')}
                        </button>
                      </div>
                      <span style="color:var(--muted);font-size:12px">{t('menu.seedHint')}</span>
                    </label>
                    {PRESETS.map((p) => (
                      <button key={p} data-testid={`preset-${p}`} aria-pressed={preset === p} onClick={() => setPreset(p)} style={`text-align:left;padding:10px;${preset === p ? 'outline:2px solid var(--accent)' : ''}`}>
                        <div style="font-weight:600">{tDynamic(`site.preset.${p}`)}</div>
                        <div style={`font-size:12px;${preset === p ? 'opacity:0.85' : 'color:var(--muted)'}`}>{PRESET_BLURB[p]}</div>
                      </button>
                    ))}
                  </div>
                  <div style="display:flex;flex-direction:column;gap:6px;align-items:center">
                    <SitePreview site={preview && preview.seed === (seed.trim() || 'GOLDEN-0001') && preview.preset === preset ? preview : null} />
                    <span style="font-size:12px;color:var(--muted)">{t('menu.windRose')}</span>
                  </div>
                </div>
              )}
              {step === 2 && (
                <div style="display:flex;flex-direction:column;gap:10px">
                  <label style="display:flex;flex-direction:column;gap:4px">
                    {t('menu.airportName')}
                    <input
                      data-testid="airport-name"
                      value={name}
                      maxLength={40}
                      onInput={(e) => {
                        const v = (e.target as HTMLInputElement).value;
                        setName(v);
                        setNameEdited(true);
                        if (!codesEdited) setCodes(codesFor(v));
                      }}
                    />
                  </label>
                  <div style="display:flex;gap:10px;flex-wrap:wrap">
                    <label style="display:flex;flex-direction:column;gap:4px;flex:1 1 120px">
                      {t('menu.iata')}
                      <input
                        data-testid="airport-iata"
                        value={codes.iata}
                        maxLength={3}
                        onInput={(e) => {
                          setCodes({ ...codes, iata: (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z]/g, '') });
                          setCodesEdited(true);
                        }}
                      />
                    </label>
                    <label style="display:flex;flex-direction:column;gap:4px;flex:1 1 120px">
                      {t('menu.icao')}
                      <input
                        data-testid="airport-icao"
                        value={codes.icao}
                        maxLength={4}
                        onInput={(e) => {
                          setCodes({ ...codes, icao: (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z]/g, '') });
                          setCodesEdited(true);
                        }}
                      />
                    </label>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:6px">
                    <span>{t('menu.brand')}</span>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                      {BRAND_COLORS.map((c) => (
                        <button key={c} data-testid={`brand-${c.slice(1)}`} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} style={`width:32px;height:32px;padding:0;border-radius:50%;background:${c};${color === c ? 'outline:3px solid var(--accent);outline-offset:2px' : ''}`} />
                      ))}
                      <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted)">
                        <input type="color" aria-label={t('menu.brandPick')} value={color} onInput={(e) => setColor((e.target as HTMLInputElement).value)} style="width:36px;height:32px;padding:0" />
                        {t('menu.brandPick')}
                      </label>
                    </div>
                  </div>
                </div>
              )}
              <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
                <button data-testid="wizard-back" onClick={() => (step === 2 ? setStep(1) : setView('main'))}>
                  {t('menu.back')}
                </button>
                {step === 1 && (
                  <button data-testid="wizard-next" onClick={() => setStep(2)}>
                    {t('menu.next')}
                  </button>
                )}
                <button data-testid="menu-start" style="padding:8px 18px" onClick={start}>
                  {t('menu.start')}
                </button>
              </div>
            </div>
          )}
          {view === 'load' && (
            <div data-testid="load-screen" style={`${panel};width:min(1000px,100%);max-height:calc(100vh - 48px)`}>
              <strong style="font-size:18px">{t('menu.load')}</strong>
              {error && (
                <div role="alert" style="color:var(--bad)">
                  {error}
                </div>
              )}
              {saves.length === 0 && <div>{t('menu.noSaves')}</div>}
              <div style="display:flex;flex-direction:column;gap:16px;overflow:auto;min-height:0">
                {byCareer(saves).map((g) => (
                  <section key={g.career} style="display:flex;flex-direction:column;gap:8px">
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                      <b>{(g.manual[0] ?? g.auto[0])?.airport ?? g.career}</b>
                      {(g.manual[0] ?? g.auto[0])?.mode === 'sandbox' && <span class="chip">{t('save.sandbox')}</span>}
                    </div>
                    {g.manual.length > 0 && (
                      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
                        {g.manual.map((s) => (
                          <div key={s.id} data-testid="save-card" style="display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--line);border-radius:10px;min-width:0">
                            {s.thumb ? (
                              <img src={s.thumb} alt="" style="width:100%;aspect-ratio:8 / 5;object-fit:cover;border-radius:6px;display:block" />
                            ) : (
                              <div style="width:100%;aspect-ratio:8 / 5;border-radius:6px;background:var(--line)" />
                            )}
                            {renaming?.id === s.id ? (
                              <form
                                style="display:flex;gap:6px"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const n = renaming.name.trim();
                                  setRenaming(null);
                                  if (n) void renameSave(s.id, n).then(refresh);
                                }}
                              >
                                <input aria-label={t('save.nameLabel')} data-testid="rename-input" value={renaming.name} maxLength={60} style="flex:1;min-width:0" onInput={(e) => setRenaming({ id: s.id, name: (e.target as HTMLInputElement).value })} />
                                <button type="submit">{t('pause.saveAsConfirm')}</button>
                              </form>
                            ) : (
                              <b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title={s.name}>
                                {s.name}
                              </b>
                            )}
                            <span style="font-size:12px;color:var(--muted)">{formatClock(s.tick)}</span>
                            <span style="font-size:12px;color:var(--muted)">{tFormat('save.paxYear', { n: formatInt(s.paxYear ?? 0) })}</span>
                            <span style="font-size:12px;color:var(--muted)">{tFormat('save.saved', { when: new Date(s.savedAt).toLocaleString() })}</span>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                              <button data-testid="save-load" onClick={() => onLoad(s)}>
                                {t('save.load')}
                              </button>
                              <button data-testid="save-rename" onClick={() => setRenaming({ id: s.id, name: s.name })}>
                                {t('save.rename')}
                              </button>
                              <button data-testid="save-duplicate" onClick={() => void duplicateSave(s.id, tFormat('save.copyName', { name: s.name })).then(refresh)}>
                                {t('save.duplicate')}
                              </button>
                              <button data-testid="save-delete" onClick={() => void deleteSave(s.id).then(refresh)}>
                                {t('save.delete')}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {g.auto.length > 0 && (
                      <div style="display:flex;flex-direction:column;gap:4px">
                        <span style="font-size:12px;color:var(--muted)">{t('menu.autosaves')}</span>
                        {g.auto.map((s) => (
                          <div key={s.id} data-testid="save-row" style="display:flex;gap:8px;align-items:center;justify-content:space-between;padding:4px 8px;border:1px solid var(--line);border-radius:10px">
                            <span style="font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                              {s.name}, {formatClock(s.tick)}
                            </span>
                            <span style="display:flex;gap:6px;flex:none">
                              <button onClick={() => onLoad(s)}>{t('save.load')}</button>
                              <button onClick={() => void deleteSave(s.id).then(refresh)}>{t('save.delete')}</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
              <label style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
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
                <button data-testid="load-back" onClick={() => setView('main')}>
                  {t('menu.back')}
                </button>
              </div>
            </div>
          )}
          {view === 'settings' && (
            <div style={`${panel};width:min(460px,100%)`}>
              <strong style="font-size:18px">{t('menu.settings')}</strong>
              <Settings autosave={autosave} onAutosave={onAutosave} onBack={() => setView('main')} />
            </div>
          )}
          {view === 'credits' && (
            <div data-testid="credits" style={`${panel};width:min(460px,100%)`}>
              <strong style="font-size:18px">{t('menu.credits')}</strong>
              <p style="margin:0;line-height:1.5">{t('menu.creditsText')}</p>
              <span style="color:var(--muted);font-size:12px">{tFormat('menu.version', { v: pkg.version })}</span>
              <div style="display:flex;justify-content:flex-end">
                <button onClick={() => setView('main')}>{t('menu.back')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
