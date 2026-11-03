/**
 * Lookup table trigonometry for state affecting math (hard rule 2).
 * The table is built with a Taylor series that only uses + - * /, so every engine
 * produces bit identical values. Rendering may use Math.sin and Math.cos instead.
 */

const TABLE_SIZE = 4096;
const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;

function taylorSin(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 12; n++) {
    term = (-term * x2) / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

function buildTable(): Float64Array {
  const table = new Float64Array(TABLE_SIZE + 1);
  for (let i = 0; i <= TABLE_SIZE; i++) {
    let a = (i * TWO_PI) / TABLE_SIZE;
    if (a > PI) a -= TWO_PI;
    table[i] = taylorSin(a);
  }
  return table;
}

const SIN_TABLE = buildTable();
const INV_TWO_PI = 1 / TWO_PI;

/** Sine with linear interpolation. Accepts any finite angle in radians. */
// hot
export function sinLut(angle: number): number {
  let t = angle * INV_TWO_PI;
  t -= Math.floor(t);
  const f = t * TABLE_SIZE;
  const i = Math.floor(f);
  const frac = f - i;
  const a = SIN_TABLE[i];
  return a + (SIN_TABLE[i + 1] - a) * frac;
}

/** Cosine with linear interpolation. */
// hot
export function cosLut(angle: number): number {
  return sinLut(angle + PI / 2);
}

export { TWO_PI, PI };
