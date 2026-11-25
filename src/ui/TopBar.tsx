import { minuteOfDay } from '@shared/business';
import { STAND_SIZES_ORDER } from '@shared/airfield';
import { WIND_BINS } from '@shared/site';
import { SPEEDS, type Speed } from '@shared/time';
import { useEffect, useState } from 'preact/hooks';
import { daySeconds, formatDate, formatMoney, formatMoneyShort, formatTime } from './format';
import { AlertCenter } from './AlertCenter';
import { useGameStore } from './stores/gameStore';
import { Icon } from './icons';
import { Clock, Pill, Popover, Stat } from './kit';
import { Coin } from './BuildMenu';
import { NARROW_PX } from './TaskBar';
import { t, tDynamic } from './strings';

interface Props {
  onSpeed(s: Speed): void;
  /** Starts or cancels the skip to the next morning (T92). */
  onSkip(on: boolean): void;
  onMenu(): void;
  /** Moves the camera to the stand with this number, for the alert center. */
  onJump(stand: string): void;
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

const WEATHER_ICON = { clear: 'sun', rain: 'rain', fog: 'cloud', wind: 'cloud' } as const;

/** The popovers the top bar owns. The alert list is the fourth, kept in the game store; only one is open at a time (rule 4.2.4). */
type Pop = 'weather' | 'aircraft' | 'stands' | 'rating' | null;

/** Width of the viewport, followed on resize, for the narrow layout of section 4.3. */
function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = (): void => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/**
 * Top bar of design revision 6 section 5.3: brand tag, weather, day phase, clock, then cash, rating, aircraft and stand pills,
 * the speed control, the alert bell and the game menu. Numbers the sim does not produce yet are left out, never invented.
 */
export function TopBar({ onSpeed, onSkip, onMenu, onJump }: Props) {
  const { tick, cash, speed, skip, business, site, tickBacklog, aircraftCount, standsFree, game, airfield, alertsOpen, toggleAlerts, overlayMenuOpen, closeOverlayMenu, setSheet } = useGameStore();
  const [pop, setPopState] = useState<Pop>(null);
  const narrow = useViewportWidth() < NARROW_PX;
  const setPop = (p: Pop): void => {
    // Opening one dropdown closes every other one, including the alert list and the overlay list.
    if (p && alertsOpen) toggleAlerts();
    if (p && overlayMenuOpen) closeOverlayMenu();
    setPopState(p);
  };
  useEffect(() => {
    if (alertsOpen || overlayMenuOpen) setPopState(null);
  }, [alertsOpen, overlayMenuOpen]);
  const close = (): void => setPopState(null);
  const rating = business ? business.rating : 0;
  const stars = rating / 20;
  const net = business ? business.today.reduce((a, b) => a + b, 0) : 0;
  const wind = site ? prevailingWind(site.windFreq, site.windMeanKt) : null;
  const hour = Math.floor(minuteOfDay(tick) / 60);
  const night = hour < 6 || hour >= 20;
  const stands = airfield.stands;
  const used = Math.max(0, stands.length - standsFree);
  const weather = business?.weather ?? 'clear';
  const sandbox = game.mode === 'sandbox';
  return (
    <div data-testid="top-bar" class="pn topbar z-top">
      <span class="tb-brand" data-testid="airport" title={game.airport.name}>
        <span class="tb-tag" style={`--brand:${game.airport.color}`}>{game.airport.iata}</span>
        <span class="tb-name">
          <b class="clip">{game.airport.name}</b>
          <small class="clip">{`${game.airport.icao} / ${game.airport.iata}`}</small>
        </span>
      </span>
      <span class="tb-div" />
      <span style="position:relative" data-pop-anchor="weather">
        <button class="tb-btn" data-testid="weather" aria-expanded={pop === 'weather'} onMouseEnter={() => setPop('weather')} onMouseLeave={close} onFocus={() => setPop('weather')} onBlur={close}>
          <Icon name={WEATHER_ICON[weather]} size={17} />
          <b>{tDynamic(`weather.${weather}`)}</b>
        </button>
        {pop === 'weather' && (
          <Popover id="weather" onClose={close} style={{ top: '42px', left: '0px', width: '220px' }} testid="weather-pop" label={t('hud.weather')}>
            <div class="pop-title">
              <Icon name={WEATHER_ICON[weather]} size={18} />
              {tDynamic(`weather.${weather}`)}
            </div>
            {wind && (
              <div class="pop-grid">
                <Stat label={t('hud.wind')} value={`${String(wind.deg).padStart(3, '0')}°`} />
                <Stat label={t('top.windSpeed')} value={wind.kt} unit="kt" />
              </div>
            )}
            <div class="pop-note">{t('hud.windTip')}</div>
          </Popover>
        )}
      </span>
      <span class="tb-phase" data-testid="day-phase" title={night ? t('top.night') : t('top.day')} style={`color:${night ? 'var(--grp-ops)' : 'var(--gold-deep)'}`}>
        <Icon name={night ? 'moon' : 'sun'} size={17} />
      </span>
      <span class="tb-clock" data-testid="clock">
        <Clock seconds={daySeconds(tick)} size={26} still={speed === 0} minuteStep={speed >= 8} />
        <span class="tb-time">
          <b>{formatTime(tick)}</b>
          {!narrow && <small>{formatDate(tick)}</small>}
        </span>
      </span>
      <span class="tb-flex" />
      <button class="pill" data-testid="cash" title={`${t('top.cashTip')}: ${formatMoney(cash)}`} onClick={() => setSheet('finance')}>
        <Coin size={16} />
        {sandbox ? t('hud.unlimited') : formatMoneyShort(cash)}
        <span data-testid="cashflow" class="num" title={t('hud.cashflowTip')} style={`color:${net >= 0 ? 'var(--good-text)' : 'var(--bad-text)'}`}>
          {`${net >= 0 ? '+' : ''}${formatMoneyShort(net)}${t('top.perDay')}`}
        </span>
      </button>
      <span style="position:relative" data-pop-anchor="rating">
        <button class="pill" data-testid="rating" aria-expanded={pop === 'rating'} title={t('top.rating')} onMouseEnter={() => setPop('rating')} onMouseLeave={close}>
          <span style="color:var(--gold)">
            <Icon name="star" size={16} />
          </span>
          {!narrow && stars.toFixed(1)}
        </button>
        {pop === 'rating' && (
          <Popover id="rating" onClose={close} style={{ top: '42px', right: '0px', width: '220px' }} testid="rating-pop" label={t('top.rating')}>
            <div class="pop-title">{t('top.rating')}</div>
            <div class="pop-grid">
              <Stat label={t('top.ratingScore')} value={Math.round(rating)} unit="/ 100" />
              <Stat label={t('top.satisfaction')} value={business ? Math.round(business.satisfaction) : 0} unit="%" />
              <Stat label={t('top.onTime')} value={business ? Math.round(business.onTimePct) : 0} unit="%" />
              <Stat label={t('hud.pax')} value={business ? business.paxToday : 0} />
            </div>
          </Popover>
        )}
      </span>
      <span style="position:relative" data-pop-anchor="aircraft">
        <Pill chevron testid="aircraft" title={t('hud.aircraft')} open={pop === 'aircraft'} onClick={() => setPop(pop === 'aircraft' ? null : 'aircraft')} icon={<span style="color:var(--accent)"><Icon name="plane" size={16} /></span>}>
          {aircraftCount}
        </Pill>
        {pop === 'aircraft' && (
          <Popover id="aircraft" onClose={close} style={{ top: '42px', right: '0px', width: '240px' }} testid="aircraft-pop" label={t('hud.aircraft')}>
            <div class="pop-title">{t('top.aircraftTitle')}</div>
            <div class="pop-grid">
              <Stat label={t('top.atAirport')} value={aircraftCount} />
              <Stat label={t('top.flightsToday')} value={business ? business.flightsToday : 0} />
            </div>
            <button class="btn bw sm" style="width:100%;margin-top:10px" data-testid="aircraft-flights" onClick={() => {
              close();
              setSheet('flights');
            }}>
              {t('top.openFlights')}
            </button>
          </Popover>
        )}
      </span>
      <span style="position:relative" data-pop-anchor="stands">
        <Pill chevron testid="stands" title={t('hud.standsTip')} open={pop === 'stands'} onClick={() => setPop(pop === 'stands' ? null : 'stands')} icon={<span style="color:var(--accent)"><Icon name="stand" size={16} /></span>}>
          {`${used}/${stands.length}`}
        </Pill>
        {pop === 'stands' && (
          <Popover id="stands" onClose={close} style={{ top: '42px', right: '0px', width: '250px' }} testid="stands-pop" label={t('hud.stands')}>
            <div class="pop-title">{t('top.standsTitle')}</div>
            <div class="pop-grid">
              <Stat label={t('top.free')} value={standsFree} />
              <Stat label={t('top.used')} value={used} />
              <Stat label={t('top.total')} value={stands.length} />
            </div>
            <div class="pop-rows">
              {STAND_SIZES_ORDER.map((z) => (
                <div key={z} class="pop-row">
                  <span>{tDynamic(`menu.variant.${z}`)}</span>
                  <b class="num">{stands.filter((s) => s.size === z).length}</b>
                </div>
              ))}
              {(['contact', 'remote', 'through'] as const).map((k) => (
                <div key={k} class="pop-row">
                  <span>{tDynamic(`top.stand.${k}`)}</span>
                  <b class="num">{stands.filter((s) => s.type === k).length}</b>
                </div>
              ))}
            </div>
          </Popover>
        )}
      </span>
      <span class="seg tb-speed" role="group" aria-label={t('hud.speedLabel')}>
        {tickBacklog > 50 && <span class="tb-lag">{`x${Math.max(Math.min(speed, 1), speed / 2)}`}</span>}
        {skip >= 0 ? (
          <span class="tb-skip" data-testid="skip-progress" title={t('hud.skipping')} aria-label={t('hud.skipping')}>
            <Icon name="skip" size={13} />
            <span class="bar">
              <i style={`width:${Math.round(Math.min(1, skip) * 100)}%`} />
            </span>
            <button class="sg" data-testid="skip-cancel" title={t('hud.skipCancel')} aria-label={t('hud.skipCancel')} onClick={() => onSkip(false)}>
              <Icon name="close" size={12} />
            </button>
          </span>
        ) : (
          <>
            {SPEEDS.map((s) => (
              <button key={s} class="sg" data-testid={`speed-${s}`} title={s === 0 ? t('hud.pause') : `${s}x`} aria-label={s === 0 ? t('hud.pause') : `${s}x`} aria-pressed={speed === s} onClick={() => onSpeed(s)}>
                {s === 0 ? <Icon name="pause" size={13} /> : `${s}x`}
              </button>
            ))}
            <span class="seg-div" />
            <button class="sg" data-testid="skip-day" title={t('hud.skipDay')} aria-label={t('hud.skipDay')} onClick={() => onSkip(true)}>
              <Icon name="skip" size={13} />
            </button>
          </>
        )}
      </span>
      <AlertCenter onJump={onJump} />
      <button class="btn bb tb-menu" data-testid="open-pause" title={t('top.pause')} aria-label={t('top.pause')} onClick={onMenu}>
        <Icon name="menu" size={16} />
      </button>
    </div>
  );
}
