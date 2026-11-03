import { describe, expect, it } from 'vitest';
import { generateSite, hashSite, toPayload } from '@sim/world/site';
import { idealHeading, crosswindCoverage } from '@sim/world/wind';
import {
  AFFORDABLE_LAND_BUDGET,
  axisDelta,
  CELL_M,
  GRID_N,
  ParcelType,
  PRESETS,
  windBand,
  WIND_BINS,
  SEASONS,
  type Preset,
} from '@shared/site';
import { cosLut, sinLut } from '@shared/trig';

const DEG = Math.PI / 180;

/** Independent check of the fairness guarantee, using only the finished site data. */
function corridorProblems(seed: string, preset: Preset): string[] {
  const site = generateSite(seed, preset);
  const c = site.corridor;
  const problems: string[] = [];
  if (axisDelta(c.headingDeg, site.idealHeadingDeg) > 40) problems.push('outside Acceptable band');
  const ax = sinLut(c.headingDeg * DEG);
  const ay = -cosLut(c.headingDeg * DEG);
  const px = -ay;
  const py = ax;
  const parcels = new Set<number>();
  let wet = 0;
  for (let t = -c.lengthM / 2; t <= c.lengthM / 2; t += 10) {
    for (let s = -c.widthM / 2; s <= c.widthM / 2; s += 10) {
      const x = c.cx + ax * t + px * s;
      const y = c.cy + ay * t + py * s;
      if (x < 0 || y < 0 || x >= GRID_N * CELL_M || y >= GRID_N * CELL_M) {
        problems.push('outside the site');
        return problems;
      }
      const o = Math.floor(y / CELL_M) * GRID_N + Math.floor(x / CELL_M);
      if (site.heights[o] < 0) wet++;
      parcels.add(site.parcelId[o]);
    }
  }
  if (wet > 0) problems.push(`${wet} water samples`);
  let cost = 0;
  for (const p of parcels) {
    const type = site.parcelType[p];
    if (type === ParcelType.Protected || type === ParcelType.Village || type === ParcelType.Wetland) problems.push(`blocked parcel type ${type}`);
    cost += site.parcelPrice[p];
  }
  if (cost > AFFORDABLE_LAND_BUDGET) problems.push(`cost ${cost} over budget`);
  return problems;
}

describe('SiteSpec', () => {
  it('is deterministic for a seed and preset', () => {
    for (const preset of PRESETS) {
      expect(hashSite(generateSite('GOLDEN-0001', preset))).toBe(hashSite(generateSite('GOLDEN-0001', preset)));
    }
  });

  it('differs between seeds and presets', () => {
    const a = hashSite(generateSite('GOLDEN-0001', 'flatCoastal'));
    expect(hashSite(generateSite('GOLDEN-0002', 'flatCoastal'))).not.toBe(a);
    expect(hashSite(generateSite('GOLDEN-0001', 'riverValley'))).not.toBe(a);
  });

  it('golden seed GOLDEN-0001 keeps its hash', () => {
    expect(hashSite(generateSite('GOLDEN-0001', 'flatCoastal'))).toBe(GOLDEN.flatCoastal);
    expect(hashSite(generateSite('GOLDEN-0001', 'riverValley'))).toBe(GOLDEN.riverValley);
  });

  it('has consistent parcel data', () => {
    for (const preset of PRESETS) {
      const s = generateSite('GOLDEN-0001', preset);
      expect(s.parcelCount).toBeGreaterThan(100);
      expect(s.parcelCount).toBeLessThan(65536);
      let sum = 0;
      for (let p = 0; p < s.parcelCount; p++) {
        sum += s.parcelAreaHa[p];
        if (s.parcelType[p] !== ParcelType.Protected) expect(s.parcelPrice[p]).toBeGreaterThan(0);
        else expect(s.parcelPrice[p]).toBe(0);
      }
      expect(sum).toBeCloseTo((GRID_N * CELL_M * GRID_N * CELL_M) / 10000, 3);
      for (const p of s.startParcels) expect(s.parcelType[p]).not.toBe(ParcelType.Protected);
      expect(new Set(s.startParcels).size).toBe(3);
    }
  });

  it('presets differ in character: sea on the coast preset, a river in the valley preset', () => {
    const waterShare = (preset: Preset): number => {
      const s = generateSite('GOLDEN-0001', preset);
      let w = 0;
      for (let i = 0; i < s.heights.length; i++) if (s.heights[i] < 0) w++;
      return w / s.heights.length;
    };
    expect(waterShare('flatCoastal')).toBeGreaterThan(0.03);
    expect(waterShare('riverValley')).toBeGreaterThan(0.002);
    expect(waterShare('riverValley')).toBeLessThan(0.1);
  });

  it('payload copies the arrays', () => {
    const s = generateSite('GOLDEN-0001', 'flatCoastal');
    const p = toPayload(s);
    expect(p.heights).not.toBe(s.heights);
    expect(p.heights[1234]).toBe(s.heights[1234]);
    expect(p.startCash).toBeGreaterThan(0);
  });

  it('fairness: an affordable 3.5 km corridor in the Acceptable band exists for 500 seeds', { timeout: 600_000 }, () => {
    const failures: string[] = [];
    for (let i = 0; i < 500; i++) {
      const preset = PRESETS[i % PRESETS.length];
      const seed = `FAIR-${i}`;
      const problems = corridorProblems(seed, preset);
      if (problems.length > 0) failures.push(`${seed} ${preset}: ${problems.join(', ')}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('Wind', () => {
  it('rose frequencies sum to one per season', () => {
    const w = generateSite('GOLDEN-0001', 'flatCoastal').wind;
    for (let s = 0; s < SEASONS; s++) {
      let sum = 0;
      for (let b = 0; b < WIND_BINS; b++) sum += w.freq[s * WIND_BINS + b];
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('ideal heading has the best coverage of all axes', () => {
    const w = generateSite('GOLDEN-0001', 'riverValley').wind;
    const ideal = idealHeading(w);
    const score = (a: number): number => crosswindCoverage(w, a, 20) + crosswindCoverage(w, a, 15);
    for (let a = 0; a < 180; a += 7) expect(score(ideal)).toBeGreaterThanOrEqual(score(a) - 1e-9);
  });

  it('bands follow the 15 and 40 degree limits, wrapping at 180', () => {
    expect(windBand(100, 100)).toBe('optimal');
    expect(windBand(115, 100)).toBe('optimal');
    expect(windBand(116, 100)).toBe('acceptable');
    expect(windBand(140, 100)).toBe('acceptable');
    expect(windBand(141, 100)).toBe('poor');
    expect(windBand(175, 5)).toBe('optimal');
    expect(windBand(0, 90)).toBe('poor');
  });
});

const GOLDEN = { flatCoastal: 2631909501, riverValley: 291297451 };
