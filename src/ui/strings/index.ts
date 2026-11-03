import { formatMoney } from '../format';
import en from './en.json';

export type StringKey = keyof typeof en;

export const t = (key: StringKey): string => en[key];

/** Looks up a string by a runtime key, for example a parcel type number. Falls back to the key. */
export const tDynamic = (key: string): string => (en as Record<string, string>)[key] ?? key;

/** Replaces `{name}` placeholders. */
export function tFormat(key: StringKey, values: Record<string, string | number>): string {
  return en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}

/** Formats a notice event such as `runwayLength` with its arguments. Money arguments are shown as currency. */
export function noticeText(code: string, args: Record<string, string>): string {
  const raw = (en as Record<string, string>)[`notice.${code}`];
  if (!raw) return code;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = args[name] ?? '';
    return name === 'cost' && v !== '' ? formatMoney(Number(v)) : v;
  });
}
