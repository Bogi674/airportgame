/** FNV-1a 32 bit hash of a string. Used for seeds and fork labels. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** Mixes two 32 bit values into one. */
function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/**
 * Seeded mulberry32 stream. `fork(label)` derives a child stream from the ORIGINAL seed
 * and the label, so forks do not depend on how much the parent has been used and each
 * subsystem owns an independent stream.
 */
export class Rng {
  readonly seed: number;
  private state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  static fromString(seed: string): Rng {
    return new Rng(hashString(seed));
  }

  fork(label: string): Rng {
    return new Rng(mix(this.seed, hashString(label)));
  }

  /** Uniform float in [0, 1). */
  // hot
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  // hot
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform float in [min, max). */
  // hot
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
