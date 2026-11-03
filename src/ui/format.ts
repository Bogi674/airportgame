const money = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

export const formatMoney = (v: number): string => money.format(v);
export const formatNumber = (v: number): string => num.format(v);
export const formatInt = (v: number): string => int.format(v);

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassName = (deg: number): string => COMPASS[Math.round(deg / 45) % 8];
