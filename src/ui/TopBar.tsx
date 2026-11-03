import { dayIndex, minuteOfDay } from '@shared/business';
import { SPEEDS, type Speed } from '@shared/time';
import { formatMoney } from './format';
import { useGameStore } from './stores/gameStore';
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
  return (
    <div
      data-testid="top-bar"
      style="position:absolute;top:0;left:0;right:0;height:40px;display:flex;align-items:center;gap:14px;padding:0 12px;background:#10161cf2;border-bottom:1px solid #2c3a45;font-size:13px"
    >
      <strong>{t('app.title')}</strong>
      <span data-testid="clock">{formatClock(tick)}</span>
      <span data-testid="cash" title={t('hud.cash')}>
        {formatMoney(cash)}
      </span>
      <span data-testid="rating" title={t('top.rating')}>
        {t('top.rating')} {Math.round(rating)}
      </span>
      {business && business.weather !== 'clear' && <span data-testid="weather">{tDynamic(`weather.${business.weather}`)}</span>}
      <span style="flex:1" />
      {tickBacklog > 50 && <span style="color:#ffcf8f">x1</span>}
      <span style="display:flex;gap:3px" aria-label={t('hud.speedLabel')}>
        {SPEEDS.map((s) => (
          <button key={s} data-testid={`speed-${s}`} aria-pressed={speed === s} onClick={() => onSpeed(s)}>
            {s === 0 ? t('hud.pause') : `${s}x`}
          </button>
        ))}
      </span>
      <button data-testid="open-airlines" onClick={() => setSheet('airlines')}>
        {t('top.airlines')}
      </button>
      <button data-testid="open-finance" onClick={() => setSheet('finance')}>
        {t('top.finance')}
      </button>
      <button data-testid="open-flights" onClick={() => setSheet('flights')}>
        {t('top.flights')}
      </button>
      <button data-testid="parcel-toggle" aria-pressed={parcelOverlay} onClick={toggleParcelOverlay}>
        {t('hud.parcels')}
      </button>
      <button data-testid="open-site" onClick={() => setSheet('site')}>
        {t('top.sites')}
      </button>
      <button data-testid="open-pause" onClick={onMenu}>
        {t('top.pause')}
      </button>
    </div>
  );
}
