import { useState } from 'preact/hooks';
import { PRESETS, PARCEL_TYPE_COUNT, ParcelType, type Preset } from '@shared/site';
import { useGameStore } from './stores/gameStore';
import { compassName, formatInt, formatMoney, formatNumber } from './format';
import { noticeText, t, tDynamic, tFormat } from './strings';

interface Props {
  onNewGame(seed: string, preset: Preset): void;
  onBuy(parcelId: number): void;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomSeed(): string {
  // UI only, so Math.random is fine here. The sim never sees it.
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${s}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/** Seed and preset controls, site facts, and the inspector for the selected parcel. */
export function SitePanel({ onNewGame, onBuy }: Props) {
  const { site, owner, cash, selectedParcel, notice } = useGameStore();
  const [seed, setSeed] = useState('GOLDEN-0001');
  const [preset, setPreset] = useState<Preset>('flatCoastal');
  const p = selectedParcel;

  let parcel = null;
  if (site && p >= 0 && p < site.parcelCount) {
    const type = site.parcelType[p];
    const owned = owner !== null && owner[p] === 1;
    const forSale = type !== ParcelType.Protected;
    const price = site.parcelPrice[p];
    parcel = (
      <div data-testid="parcel" style="margin-top:8px;border-top:1px solid #2c3a45;padding-top:8px">
        <div style="font-weight:600">
          {t('parcel.title')} {p}: {tDynamic(`parcel.type.${Math.min(type, PARCEL_TYPE_COUNT - 1)}`)}
        </div>
        <div>
          {t('parcel.area')}: {formatNumber(site.parcelAreaHa[p])} ha
        </div>
        {forSale && (
          <div>
            {t('parcel.price')}: {formatMoney(price)}
          </div>
        )}
        {site.parcelExtraCost[p] > 0 && (
          <div>
            {t('parcel.extra')}: {formatMoney(site.parcelExtraCost[p])}
          </div>
        )}
        {site.parcelResettleDays[p] > 0 && (
          <div>
            {t('parcel.resettle')}: {tFormat('parcel.days', { n: site.parcelResettleDays[p] })}
          </div>
        )}
        {owned ? (
          <div style="color:#ffd24a">{t('parcel.owned')}</div>
        ) : !forSale ? (
          <div style="color:#ff8f8f">{t('parcel.notForSale')}</div>
        ) : (
          <button data-testid="buy" style="margin-top:4px" disabled={price > cash} onClick={() => onBuy(p)}>
            {t('parcel.buy')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="site-panel"
      style="position:absolute;top:8px;right:8px;width:250px;padding:8px 10px;background:#10161ce6;border:1px solid #2c3a45;border-radius:6px"
    >
      <div style="font-weight:600;margin-bottom:4px">{t('site.title')}</div>
      <div style="display:flex;gap:4px;align-items:center">
        <input aria-label={t('site.seed')} data-testid="seed" value={seed} onInput={(e) => setSeed((e.target as HTMLInputElement).value)} style="width:100px" />
        <button onClick={() => setSeed(randomSeed())}>{t('site.shuffle')}</button>
      </div>
      <div style="display:flex;gap:4px;margin-top:4px">
        <select aria-label={t('site.preset')} data-testid="preset" value={preset} onChange={(e) => setPreset((e.target as HTMLSelectElement).value as Preset)}>
          {PRESETS.map((pr) => (
            <option key={pr} value={pr}>
              {tDynamic(`site.preset.${pr}`)}
            </option>
          ))}
        </select>
        <button data-testid="new-game" onClick={() => onNewGame(seed.trim() || 'GOLDEN-0001', preset)}>
          {t('site.start')}
        </button>
      </div>
      {site && (
        <div data-testid="site-info" style="margin-top:8px;line-height:1.5">
          <div>
            {t('hud.cash')}: {formatMoney(cash)}
          </div>
          <div>
            {t('site.idealHeading')}: {String(site.idealHeadingDeg).padStart(3, '0')}°
          </div>
          <div>
            {t('site.climate')}: {site.climate.type}, {site.climate.tempMinC} to {site.climate.tempMaxC} °C
          </div>
          <div>
            {t('site.city')}:{' '}
            {tFormat('site.cityValue', { pop: formatInt(site.city.population), dist: formatNumber(site.city.distanceKm), dir: compassName(site.city.directionDeg) })}
          </div>
        </div>
      )}
      {parcel}
      {notice && (
        <div role="alert" data-testid="notice" style="margin-top:6px;color:#ff8f8f">
          {noticeText(notice.code, notice.args)}
        </div>
      )}
    </div>
  );
}
