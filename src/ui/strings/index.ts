import en from './en.json';

export type StringKey = keyof typeof en;

export const t = (key: StringKey): string => en[key];

/** Looks up a string by a runtime key, for example a parcel type number. Falls back to the key. */
export const tDynamic = (key: string): string => (en as Record<string, string>)[key] ?? key;

/** Replaces `{name}` placeholders. */
export function tFormat(key: StringKey, values: Record<string, string | number>): string {
  return en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
