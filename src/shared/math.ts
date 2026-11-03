export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Site space is an 8 by 8 km world in meters (docs/ARCHITECTURE.md section 4). */
export const SITE_SIZE_M = 8000;

/** Static layers bake into chunks of this size in meters. */
export const CHUNK_SIZE_M = 512;
