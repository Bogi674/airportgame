import { minuteOfDay } from '@shared/business';
import { WIND_BINS } from '@shared/site';
import { SPEEDS, type Speed } from '@shared/time';
import { formatClock, formatMoney } from './format';
import { AlertCenter } from './AlertCenter';
import { useGameStore } from './stores/gameStore';
import { useState } from 'preact/hooks';
import { Icon } from './icons';
import { OverlayMenu } from './OverlayMenu';
import { currentTheme, setTheme } from './theme';
import { t, tDynamic } from './strings';

interface Props {
  onSpeed(s: Speed): void;
  /** Starts or cancels the skip to the next morning (T92). */
  onSkip(on: boolean): void;
  onMenu(): void;
  /** Moves the camera to the stand with this number, for the alert center. */
  onJump(stand: string): void;
}

function Chip({ label, value, testId, title, tone }: { label: string; value: preact.ComponentChildren; testId?: string; title?: string; tone?: string }) {
  return (
    <span class="chip" data-testid={testId} title={title}>
      <span class="lbl">{label}</span>
      <b style={tone ? `color:${tone}` : undefined}>{value}</b>
    </span>
  );
}

/** Prevailing wind of the site: the most frequent direction over all seasons and its mean speed. */
function prevailingWind(freq: Float32Array, mean: Float32Array): { deg: number; kt: number } {
  let best = 0;
  let bestF = -1;
  for (let b = 0; b < WIND_BINS; b++) {
    let f = 0;
    for (let s = 0; s < freq.length / WIND_BINS; s++) f += freq[s * WIND_BINS + b];
    if (f > bestF) {
      bestF = f;
      best = b;
    }
  }
  let kt = 0;
  let n = 0;
  for (let s = 0; s < mean.length / WIND_BINS; s++) {
    kt += mean[s * WIND_BINS + best];
    n++;
  }
  return { deg: Math.round((best * 360) / WIND_BINS), kt: n > 0 ? Math.round(kt / n) : 0 };
}

/** Floating HUD: information chips at the top left, game controls at the top right. No bar. */
export function TopBar({ onSpeed, onSkip, onMenu, onJump }: Props) {
  const { tick, cash, speed, skip, business, site, setSheet, tickBacklog, parcelOverlay, toggleParcelOverlay, aircraftCount, standsFree, quality, setQuality, overlay, overlayMenuOpen, toggleOverlayMenu, game } = useGameStore();
  const [settings, setSettings] = useState(false);
  const rating = business ? business.rating : 0;
  const rate = Math.max(0, Math.min(100, rating));
  const net = business ? business.today.reduce((a, b) => a + b, 0) : 0;
  const wind = site ? prevailingWind(site.windFreq, site.windMeanKt) : null;
  const hour = Math.floor(minuteOfDay(tick) / 60);
  const night = hour < 6 || hour >= 20;
  const light = currentTheme() === 'light';
  const toggleTheme = (): void => {
    setTheme(light ? 'dark' : 'light');
    setSettings(false);
    setSheet(useGameStore.getState().sheet);
  };
  const sheetBtn = (k: 'airlines' | 'finance' | 'flights' | 'site', icon: 'airlines' | 'finance' | 'flights' | 'site', label: string) => (
    <button class="round" data-testid={`open-${k}`} title={label} aria-label={label} onClick={() => setSheet(k)}>
      <Icon name={icon} size={16} />
    </button>
  );
  return (
    <div data-testid="top-bar" style="position:absolute;inset:0;pointer-events:none;z-index:5">
      <div class="hud hud-left">
        <span class="chip" data-testid="airport" title={game.airport.name}>
          <span aria-hidden="true" style={`width:10px;height:10px;border-radius:50%;flex:none;background:${game.airport.color}`} />
          <b>{game.airport.iata}</b>
          <span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{game.airport.name}</span>
        </span>
        <span class="chip" data-testid="clock">
          <Icon name={night ? 'moon' : 'sun'} size={14} />
          {formatClock(tick)}
        </span>
        <Chip label={t('hud.weather')} testId="weather" value={business ? tDynamic(`weather.${business.weather}`) : '-'} />
        {wind && <Chip label={t('hud.wind')} testId="wind" title={t('hud.windTip')} value={`${String(wind.deg).padStart(3, '0')}° ${wind.kt} kt`} />}
        <Chip label={t('hud.cash')} testId="cash" value={game.mode === 'sandbox' ? t('hud.unlimited') : formatMoney(cash)} />
        <Chip label={t('hud.cashflow')} testId="cashflow" title={t('hud.cashflowTip')} value={`${net >= 0 ? '+' : ''}${formatMoney(net)}`} tone={net >= 0 ? 'var(--ok)' : 'var(--bad)'} />
        <span class="chip" data-testid="rating" title={t('top.rating')}>
          <span class="lbl">{t('top.rating')}</span>
          <b>{Math.round(rating)}</b>
          <span class="bar">
            <i style={`width:${rate}%`} />
          </span>
        </span>
        <Chip label={t('hud.pax')} testId="pax" title={t('hud.paxTip')} value={business ? business.paxToday : 0} />
        <Chip label={t('hud.aircraft')} testId="aircraft" value={aircraftCount} />
        <Chip label={t('hud.stands')} testId="stands" title={t('hud.standsTip')} value={standsFree} />
      </div>
      <div class="hud hud-right">
        <span class="cluster" aria-label={t('hud.speedLabel')}>
          {tickBacklog > 50 && <span style="color:var(--warn);font-size:12px">{`x${Math.max(Math.min(speed, 1), speed / 2)}`}</span>}
          {skip >= 0 && (
            <span class="chip" data-testid="skip-progress" title={t('hud.skipping')} aria-label={t('hud.skipping')}>
              <Icon name="skip" size={12} />
              <span class="bar">
                <i style={`width:${Math.round(Math.min(1, skip) * 100)}%`} />
              </span>
              <button class="round" data-testid="skip-cancel" title={t('hud.skipCancel')} aria-label={t('hud.skipCancel')} onClick={() => onSkip(false)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          )}
          {skip < 0 && SPEEDS.map((s) => (
            <button key={s} class="round" data-testid={`speed-${s}`} title={s === 0 ? t('hud.pause') : `${s}x`} aria-label={s === 0 ? t('hud.pause') : `${s}x`} aria-pressed={speed === s} onClick={() => onSpeed(s)} style="font-size:11px">
              {s === 0 ? <Icon name="pause" size={14} /> : `${s}x`}
            </button>
          ))}
          {skip < 0 && (
            <button class="round" data-testid="skip-day" title={t('hud.skipDay')} aria-label={t('hud.skipDay')} onClick={() => onSkip(true)}>
              <Icon name="skip" size={14} />
            </button>
          )}
        </span>
        <span class="cluster">
          {sheetBtn('airlines', 'airlines', t('top.airlines'))}
          {sheetBtn('finance', 'finance', t('top.finance'))}
          {sheetBtn('flights', 'flights', t('top.flights'))}
          {sheetBtn('site', 'site', t('top.sites'))}
          <span style="position:relative">
            <button class="round" data-testid="overlay-menu" title={t('hud.overlay.title')} aria-label={t('hud.overlay.title')} aria-haspopup="menu" aria-expanded={overlayMenuOpen} aria-pressed={overlay !== 'none'} onClick={toggleOverlayMenu}>
              <Icon name="overlay" size={16} />
            </button>
            {overlayMenuOpen && <OverlayMenu />}
          </span>
          <button class="round" data-testid="parcel-toggle" title={t('hud.parcels')} aria-label={t('hud.parcels')} aria-pressed={parcelOverlay} onClick={toggleParcelOverlay}>
            <Icon name="parcels" size={16} />
            <span class="kbd">P</span>
          </button>
        </span>
        <span class="cluster" style="position:relative">
          <AlertCenter onJump={onJump} />
          <button class="round" data-testid="open-settings" title={t('top.settings')} aria-label={t('top.settings')} aria-pressed={settings} onClick={() => setSettings(!settings)}>
            <Icon name="settings" size={16} />
          </button>
          <button class="round" data-testid="open-pause" title={t('top.pause')} aria-label={t('top.pause')} onClick={onMenu}>
            <Icon name="menu" size={16} />
          </button>
          {settings && (
            <div class="panel" data-testid="settings-panel" style="position:absolute;right:0;top:44px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-width:190px;z-index:30">
              <div class="section">{t('top.settings')}</div>
              <label style="font-size:12px;display:flex;flex-direction:column;gap:4px">
                {t('settings.quality')}
                <select data-testid="quality-select" value={quality} onChange={(e) => setQuality((e.target as HTMLSelectElement).value as 'auto' | 'low' | 'medium' | 'high')}>
                  {(['auto', 'low', 'medium', 'high'] as const).map((q) => (
                    <option key={q} value={q}>
                      {tDynamic(`settings.quality.${q}`)}
                    </option>
                  ))}
                </select>
              </label>
              <button data-testid="theme-toggle" onClick={toggleTheme} style="display:inline-flex;gap:8px;align-items:center;justify-content:center">
                <Icon name={light ? 'moon' : 'sun'} size={15} />
                {light ? t('settings.dark') : t('settings.light')}
              </button>
            </div>
          )}
        </span>
      </div>
    </div>
  );
}
