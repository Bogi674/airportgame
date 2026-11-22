import { tDynamic, tFormat, type StringKey } from './strings';
import { formatInt } from './format';

/** Event codes that become alerts, as opposed to build notices. */
export const ALERT_CODES = new Set(['airlineSigned', 'airlineIdle', 'noAtc', 'atcLost', 'weatherStart', 'weatherEnd', 'flightRefused', 'flightDiverted', 'flightLost', 'deadlock', 'seriesExpired', 'seriesRenewal', 'seriesCancelled', 'seriesOffered', 'airlineLeft', 'airlineApproach', 'fuelShort', 'flightGrounded', 'fuelOrdered', 'fireGrace', 'beltsKept']);

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
    case 'seriesExpired':
    case 'seriesRenewal':
    case 'seriesCancelled':
      return { text: tDynamic(`alert.${name}`).replace('{name}', args.name ?? '').replace('{dest}', args.dest ?? ''), tone: name === 'seriesRenewal' ? 'info' : 'warn' };
    case 'seriesOffered':
    case 'airlineApproach':
    case 'airlineLeft':
      return { text: tDynamic(`alert.${name}`).replace('{name}', args.name ?? ''), tone: name === 'airlineLeft' ? 'warn' : 'info' };
    case 'airlineIdle':
      return { text: tFormat('alert.airlineIdle', { name: args.name ?? '' }), tone: 'warn' };
    case 'noAtc':
      return { text: tFormat('alert.noAtc', { name: args.name ?? '' }), tone: 'warn' };
    case 'atcLost':
      return { text: tDynamic('alert.atcLost'), tone: 'warn' };
    case 'weatherStart':
      return { text: tFormat('alert.weatherStart', { kind: tDynamic(`weather.${args.kind}`) }), tone: 'warn' };
    case 'weatherEnd':
      return { text: tDynamic('alert.weatherEnd'), tone: 'info' };
    case 'flightRefused':
      return { text: tFormat('alert.flightRefused', { type: args.type ?? '', reason: reasonText(args) }), tone: 'warn' };
    case 'flightDiverted':
      return { text: tFormat('alert.flightDiverted', { type: args.type ?? '', reason: reasonText(args) }), tone: 'warn' };
    case 'fuelShort':
      return { text: tFormat('alert.fuelShort', { type: args.type ?? '' }), tone: 'warn' };
    case 'flightGrounded':
      return { text: tFormat('alert.flightGrounded', { type: args.type ?? '' }), tone: 'warn' };
    case 'fuelOrdered':
      return { text: tFormat('alert.fuelOrdered', { n: args.n ?? '' }), tone: 'info' };
    case 'beltsKept':
      return { text: tFormat('alert.beltsKept', { n: args.n ?? '' }), tone: 'warn' };
    case 'fireGrace':
      return { text: tFormat('alert.fireGrace', { needed: args.needed ?? '', available: args.available ?? '', days: args.days ?? '' }), tone: 'warn' };
    case 'flightLost':
      return { text: tFormat('alert.flightLost' as StringKey, { type: args.type ?? '' }), tone: 'warn' };
    default:
      return { text: tDynamic('alert.deadlock'), tone: 'warn' };
  }
}
