import { describe, expect, it } from 'vitest';
import { SURFACE_SPEC } from '@data/index';
import type { AirfieldPayload } from '@shared/airfield';
import { CHUNK_SIZE_M } from '@shared/math';
import type { Pt } from '@shared/geom';
import { standForks } from '@shared/standFork';
import { paintAirfield } from '@render/markings/airfieldPaint';
import { buildPlan, type Line } from '@render/markings/taxiPlan';
import { ownedSim, run } from './helpers';

/** GA scene: runway 09/27, a parallel code C taxiway at y 5190, a GA block and an apron that joins it to the taxiway. */
const TAXI_Y = 5190;
const TAXI_X0 = 3000;
const TAXI_X1 = 5000;

type Command = Parameters<typeof run>[1];

function gaScene(): AirfieldPayload {
  const sim = ownedSim();
  const errors: string[] = [];
  const go = (c: Command): void => {
    errors.push(...run(sim, c));
  };
  go({ type: 'buildRunway', x: 3000, y: 5000, headingDeg: 90, lengthM: 2600, code: 'C', approach: 'precision', surface: 'asphalt', tier: 2 });
  go({ type: 'buildTaxiway', points: [{ x: TAXI_X0, y: TAXI_Y }, { x: TAXI_X1, y: TAXI_Y }], code: 'C', kind: 'taxiway', surface: 'asphalt', tier: 2 });
  go({ type: 'buildApron', polygon: [{ x: 3400, y: 5196 }, { x: 4200, y: 5196 }, { x: 4200, y: 5262 }, { x: 3400, y: 5262 }], surface: 'concrete', tier: 2 });
  go({ type: 'buildGaBlock', x: 3500, y: 5290, headingDeg: 180, count: 4, surface: 'concrete' });
  if (errors.length > 0) throw new Error(`GA scene failed: ${errors.join(', ')}`);
  return sim.airfield.data;
}

/** Distance from a point to the nearest segment of any line in the list. */
function distToLines(p: Pt, lines: readonly Line[]): number {
  let best = Infinity;
  for (const l of lines) {
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1];
      const b = l.pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
    }
  }
  return best;
}

interface Op {
  name: string;
  fillStyle: string;
  strokeStyle: string;
  args: unknown[];
}

/** A canvas context that records every drawing call with the fill and stroke styles in force. */
function recordingContext(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  const state: Record<string, unknown> = { fillStyle: '#000000', strokeStyle: '#000000' };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (): { width: number } => ({ width: 1 });
      return (...args: unknown[]): void => {
        ops.push({ name: prop, fillStyle: String(target.fillStyle), strokeStyle: String(target.strokeStyle), args });
      };
    },
    set(target, prop, value: unknown) {
      if (typeof prop === 'string') target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

/** Slab joints and ground contact are not marks; they sit under the pavement and the paint. */
const SLAB_JOINT = 'rgba(40,38,34,0.18)';
const isGroundContact = (o: Op): boolean => o.name === 'stroke' && (o.strokeStyle.startsWith('rgba(74,62,44') || o.strokeStyle === SLAB_JOINT);
const MARK_FILLS = ['#f1f1ec', '#d8362f', '#f2c230', '#e0414a', '#111111'];
const isMark = (o: Op): boolean =>
  (o.name === 'stroke' && !isGroundContact(o)) || ((o.name === 'fill' || o.name === 'fillRect') && MARK_FILLS.includes(o.fillStyle));
const PAVEMENT_COLORS = Object.values(SURFACE_SPEC).map((s) => s.color);
const isPavementFill = (o: Op): boolean => (o.name === 'fill' || o.name === 'fillRect') && PAVEMENT_COLORS.includes(o.fillStyle);

describe('lead in paint', () => {
  const af = gaScene();
  const plan = buildPlan(af);
  const taxi = af.taxiways[0];

  it('the GA scene has a lead in fork for every GA stand on the taxiway', () => {
    const forks = standForks(af.stands, af.taxiways.map((t) => ({ pts: t.points })));
    const found = forks.filter((f) => f !== null);
    expect(af.stands.length).toBeGreaterThan(0);
    expect(found.length).toBe(af.stands.length);
  });

  it('each lead in ends on the taxiway centerline at the point the fork hits', () => {
    const forks = standForks(af.stands, af.taxiways.map((t) => ({ pts: t.points })));
    for (const f of forks) {
      if (!f) continue;
      for (const arc of f.arcs) {
        const end = arc[arc.length - 1];
        expect(distToLines(end, plan.centerlines)).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('the taxiway centerline covers the taxiway length with no gap at a fork join', () => {
    const runs = plan.centerlines
      .filter((l) => l.pts.every((p) => Math.abs(p.y - TAXI_Y) < 0.01))
      .map((l) => [Math.min(...l.pts.map((p) => p.x)), Math.max(...l.pts.map((p) => p.x))] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(runs.length).toBeGreaterThan(0);
    const start = Math.min(...taxi.points.map((p) => p.x));
    const end = Math.max(...taxi.points.map((p) => p.x));
    let reach = runs[0][0];
    expect(reach - start).toBeLessThanOrEqual(0.05);
    for (const [a, b] of runs) {
      expect(a - reach).toBeLessThanOrEqual(0.05);
      reach = Math.max(reach, b);
    }
    expect(end - reach).toBeLessThanOrEqual(0.05);
  });

  it('every apron and taxiway pavement fill is painted before any mark, in every chunk the scene touches', () => {
    let fills = 0;
    for (let cx = Math.floor(2400 / CHUNK_SIZE_M); cx <= Math.floor(4400 / CHUNK_SIZE_M); cx++) {
      for (let cy = Math.floor(4800 / CHUNK_SIZE_M); cy <= Math.floor(5400 / CHUNK_SIZE_M); cy++) {
        const { ctx, ops } = recordingContext();
        paintAirfield(ctx, af, [], 2, cx, cy);
        const firstMark = ops.findIndex(isMark);
        if (firstMark < 0) continue;
        for (let i = 0; i < ops.length; i++) {
          if (!isPavementFill(ops[i])) continue;
          fills++;
          expect(i).toBeLessThan(firstMark);
        }
      }
    }
    expect(fills).toBeGreaterThanOrEqual(af.aprons.length + 1);
  });
});
