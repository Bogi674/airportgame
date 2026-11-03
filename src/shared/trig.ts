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

function atanSmall(x: number): number {
  // |x| <= tan(pi/8) after two halvings, so a short Taylor series is exact to ~1e-12.
  const x2 = x * x;
  return x * (1 - x2 / 3 + (x2 * x2) / 5 - (x2 * x2 * x2) / 7 + (x2 * x2 * x2 * x2) / 9);
}

/** Arctangent of y / x in radians using only + - * / and sqrt, so it is identical everywhere. */
export function atan2Det(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const swap = ay > ax;
  let t = swap ? ax / ay : ay / ax;
  // Two argument halvings: atan(t) = 2 atan(t / (1 + sqrt(1 + t^2))).
  t = t / (1 + Math.sqrt(1 + t * t));
  t = t / (1 + Math.sqrt(1 + t * t));
  let a = 4 * atanSmall(t);
  if (swap) a = PI / 2 - a;
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

export { TWO_PI, PI };
