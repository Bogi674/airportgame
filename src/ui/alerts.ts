import { tDynamic, tFormat, type StringKey } from './strings';
import { formatInt } from './format';

/** Event codes that become alerts, as opposed to build notices. */
export const ALERT_CODES = new Set(['airlineSigned', 'airlineIdle', 'noAtc', 'weatherStart', 'weatherEnd', 'flightRefused', 'flightDiverted', 'flightLost', 'deadlock']);

export function parseEvent(code: string): { name: string; args: Record<string, string> } {
  const parts = code.split('|');
  const args: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq > 0) args[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
  }
  return { name: parts[0], args };
}

function reasonText(args: Record<string, string>): string {
  // The reason is the first bare segment of the event, which parseEvent keeps as `reason`.
  const key = `reason.${args.reason}`;
  const raw = tDynamic(key);
  return raw.replace(/\{(\w+)\}/g, (_, n: string) => (args[n] ? formatInt(Number(args[n])) : ''));
}

export function alertText(code: string): { text: string; tone: 'info' | 'warn' } {
  const { name, args } = parseEvent(code);
  switch (name) {
    case 'airlineSigned':
      return { text: tFormat('alert.airlineSigned', { name: args.name ?? '' }), tone: 'info' };
    case 'airlineIdle':
      return { text: tFormat('alert.airlineIdle', { name: args.name ?? '' }), tone: 'warn' };
    case 'noAtc':
      return { text: tFormat('alert.noAtc', { name: args.name ?? '' }), tone: 'warn' };
    case 'weatherStart':
      return { text: tFormat('alert.weatherStart', { kind: tDynamic(`weather.${args.kind}`) }), tone: 'warn' };
    case 'weatherEnd':
      return { text: tDynamic('alert.weatherEnd'), tone: 'info' };
    case 'flightRefused':
      return { text: tFormat('alert.flightRefused', { type: args.type ?? '', reason: reasonText(args) }), tone: 'warn' };
    case 'flightDiverted':
      return { text: tFormat('alert.flightDiverted', { type: args.type ?? '', reason: reasonText(args) }), tone: 'warn' };
    case 'flightLost':
      return { text: tFormat('alert.flightLost' as StringKey, { type: args.type ?? '' }), tone: 'warn' };
    default:
      return { text: tDynamic('alert.deadlock'), tone: 'warn' };
  }
}
