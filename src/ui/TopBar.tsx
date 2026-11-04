import { dayIndex, minuteOfDay } from '@shared/business';
import { SPEEDS, type Speed } from '@shared/time';
import { formatMoney } from './format';
import { useGameStore } from './stores/gameStore';
import { Icon } from './icons';
import { currentTheme, setTheme } from './theme';
import { t, tDynamic } from './strings';

interface Props {
  onSpeed(s: Speed): void;
  onMenu(): void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatClock(tick: number): string {
  const d = new Date(Date.UTC(2027, 0, 1 + dayIndex(tick)));
  const m = minuteOfDay(tick);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

/** Top bar: date, cash, rating, weather, speed and the sheets. */
export function TopBar({ onSpeed, onMenu }: Props) {
  const { tick, cash, speed, business, setSheet, tickBacklog, parcelOverlay, toggleParcelOverlay } = useGameStore();
  const rating = business ? business.rating : 0;
  const rate = Math.max(0, Math.min(100, rating));
  const toggleTheme = (): void => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    setSheet(useGameStore.getState().sheet);
  };
  const light = currentTheme() === 'light';
  return (
    <div data-testid="top-bar" class="topbar">
      <span class="brand">{t('app.title')}</span>
      <span class="chip" data-testid="clock">
        {formatClock(tick)}
      </span>
      <span class="chip" data-testid="cash" title={t('hud.cash')}>
        <span class="lbl">{t('hud.cash')}</span>
        <b>{formatMoney(cash)}</b>
      </span>
      <span class="chip" data-testid="rating" title={t('top.rating')}>
        <span class="lbl">{t('top.rating')}</span>
        <b>{Math.round(rating)}</b>
        <span class="bar">
          <i style={`width:${rate}%`} />
        </span>
      </span>
      {business && business.weather !== 'clear' && (
        <span class="chip" data-testid="weather">
          {tDynamic(`weather.${business.weather}`)}
        </span>
      )}
      <span style="flex:1" />
      {tickBacklog > 50 && <span style="color:var(--warn)">x1</span>}
      <span style="display:flex;gap:3px" aria-label={t('hud.speedLabel')}>
        {SPEEDS.map((s) => (
          <button key={s} data-testid={`speed-${s}`} aria-pressed={speed === s} onClick={() => onSpeed(s)} style="padding:3px 10px">
            {s === 0 ? t('hud.pause') : `${s}x`}
          </button>
        ))}
      </span>
      <button class="round" data-testid="open-airlines" title={t('top.airlines')} aria-label={t('top.airlines')} onClick={() => setSheet('airlines')}>
        <Icon name="airlines" size={16} />
      </button>
      <button class="round" data-testid="open-finance" title={t('top.finance')} aria-label={t('top.finance')} onClick={() => setSheet('finance')}>
        <Icon name="finance" size={16} />
      </button>
      <button class="round" data-testid="open-flights" title={t('top.flights')} aria-label={t('top.flights')} onClick={() => setSheet('flights')}>
        <Icon name="flights" size={16} />
      </button>
      <button class="round" data-testid="parcel-toggle" title={t('hud.parcels')} aria-label={t('hud.parcels')} aria-pressed={parcelOverlay} onClick={toggleParcelOverlay}>
        <Icon name="parcels" size={16} />
        <span class="kbd">P</span>
      </button>
      <button class="round" data-testid="open-site" title={t('top.sites')} aria-label={t('top.sites')} onClick={() => setSheet('site')}>
        <Icon name="site" size={16} />
      </button>
      <button class="round" data-testid="theme-toggle" title={t('top.theme')} aria-label={t('top.theme')} onClick={toggleTheme}>
        <Icon name={light ? 'moon' : 'sun'} size={16} />
      </button>
      <button class="round" data-testid="open-pause" title={t('top.pause')} aria-label={t('top.pause')} onClick={onMenu}>
        <Icon name="menu" size={16} />
      </button>
    </div>
  );
}
