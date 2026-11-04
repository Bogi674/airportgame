import * as clipping from 'polygon-clipping';

/**
 * polygon-clipping ships one default object. Bundlers expose its functions as named exports, plain
 * Node (the stress script) only as `default`, so every caller goes through this module.
 */
type Clipping = typeof clipping;
const lib: Clipping = (clipping as Clipping & { default?: Clipping }).default ?? clipping;

export type { MultiPolygon, Polygon, Ring } from 'polygon-clipping';
export const union: Clipping['union'] = (...a) => lib.union(...a);
export const difference: Clipping['difference'] = (...a) => lib.difference(...a);
