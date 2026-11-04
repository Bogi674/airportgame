import { ParcelType, PARCEL_TYPE_COUNT } from '@shared/site';
import { formatMoney, formatNumber } from './format';
import { useGameStore } from './stores/gameStore';
import { t, tDynamic, tFormat } from './strings';

interface Props {
  onBuy(parcelId: number): void;
}

/** Inspector for the selected parcel with the buy button. */
export function ParcelPanel({ onBuy }: Props) {
  const { site, owner, cash, selectedParcel: p } = useGameStore();
  if (!site || p < 0 || p >= site.parcelCount) return null;
  const type = site.parcelType[p];
  const owned = owner !== null && owner[p] === 1;
  const forSale = type !== ParcelType.Protected;
  const price = site.parcelPrice[p];
  return (
    <div data-testid="parcel" style="position:absolute;right:12px;top:52px;width:240px;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;line-height:1.5">
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
        <div style="color:var(--bad)">{t('parcel.notForSale')}</div>
      ) : (
        <button data-testid="buy" style="margin-top:4px" disabled={price > cash} onClick={() => onBuy(p)}>
          {t('parcel.buy')}
        </button>
      )}
    </div>
  );
}
