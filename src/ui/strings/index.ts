import en from './en.json';

export type StringKey = keyof typeof en;

export const t = (key: StringKey): string => en[key];
