const FNV_PRIME = 0x01000193;
export const HASH_INIT = 0x811c9dc5;

/** Folds one 32 bit value into a running hash. */
// hot
export function foldU32(h: number, v: number): number {
  return Math.imul(h ^ (v >>> 0), FNV_PRIME) >>> 0;
}

/** Folds the first `count` elements of a Float64Array by their raw bits. */
// hot
export function foldF64(h: number, bits: Uint32Array, count: number): number {
  const words = count * 2;
  let acc = h;
  for (let i = 0; i < words; i++) acc = foldU32(acc, bits[i]);
  return acc;
}

/** Folds the first `count` elements of an Int32Array or Uint8Array. */
// hot
export function foldInts(h: number, arr: Int32Array | Uint8Array, count: number): number {
  let acc = h;
  for (let i = 0; i < count; i++) acc = foldU32(acc, arr[i]);
  return acc;
}
