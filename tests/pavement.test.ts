import { describe, expect, it } from 'vitest';
import { union, type MultiPolygon } from 'polygon-clipping';
import { AIRFIELD } from '../src/data/index';
import type { CodeLetter } from '../src/shared/airfield';
import type { Pt } from '../src/shared/geom';
import { buildPavement, filletLine, type PaveGraph } from '../src/shared/pavement/pavement';

const DEG = Math.PI / 180;

/** Small deterministic generator for test inputs. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function star(angles: readonly number[], code: CodeLetter = 'C', armLen = 400): PaveGraph {
  const hw = AIRFIELD.codes[code].taxiwayWidthM / 2;
  const nodes = [{ id: 0, x: 0, y: 0 }];
  const edges = angles.map((a, i) => {
    nodes.push({ id: i + 1, x: Math.cos(a) * armLen, y: Math.sin(a) * armLen });
    return { id: i, a: 0, b: i + 1, hw, code, surface: 'asphalt' as const, kind: 'taxiway' as const, closed: false };
  });
  return { nodes, edges };
}

function randomAngles(rand: () => number, n: number, minSep: number): number[] {
  for (;;) {
    const a = Array.from({ length: n }, () => rand() * 2 * Math.PI).sort((p, q) => p - q);
    let ok = true;
    for (let i = 0; i < n; i++) {
      const gap = i === n - 1 ? a[0] + 2 * Math.PI - a[i] : a[i + 1] - a[i];
      if (gap < minSep) ok = false;
    }
    if (ok) return a;
  }
}

const ringArea = (r: readonly { x: number; y: number }[]): number => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const q = r[(i + 1) % r.length];
    a += r[i].x * q.y - q.x * r[i].y;
  }
  return a / 2;
};

/** Merges every fill the way the screen shows them. Zero area slivers where two pieces touch are merge noise and are dropped. */
const mergedFill = (fills: { polys: Pt[][][] }[]): MultiPolygon => {
  for (const f of fills) for (const p of f.polys) for (const r of p) expect(Math.abs(ringArea(r))).toBeGreaterThan(0.5);
  const geoms = fills.flatMap((f) => f.polys.map((p) => p.map((r) => r.map((q) => [q.x, q.y] as [number, number]))));
  const merged = union(geoms[0], ...geoms.slice(1));
  return merged.map((poly) => poly.filter((r, i) => i === 0 || Math.abs(ringArea(r.map(([x, y]) => ({ x, y })))) > 1e-6));
};

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

/** A ring is valid when it has an area and no two non adjacent edges cross. */
function validRing(r: readonly [number, number][]): boolean {
  const pts = r.map(([x, y]) => ({ x, y }));
  const n = pts.length - 1;
  if (n < 3) return false;
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
  if (Math.abs(area) < 1) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) return false;
    }
  }
  return true;
}

function distToRings(p: Pt, mp: MultiPolygon): number {
  let best = Infinity;
  for (const poly of mp) {
    for (const r of poly) {
      for (let i = 0; i + 1 < r.length; i++) {
        const [ax, ay] = r[i];
        const [bx, by] = r[i + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
        best = Math.min(best, Math.hypot(p.x - (ax + dx * t), p.y - (ay + dy * t)));
      }
    }
  }
  return best;
}

describe('junction geometry (revision 2 test 2)', () => {
  const rand = lcg(20261104);
  for (const n of [3, 4, 5]) {
    for (let round = 0; round < 6; round++) {
      const angles = randomAngles(rand, n, 30 * DEG);
      it(`${n} arms, case ${round}`, () => {
        const code: CodeLetter = (['B', 'C', 'D', 'E', 'F'] as const)[round % 5];
        const geo = buildPavement(star(angles, code));
        const hw = AIRFIELD.codes[code].taxiwayWidthM / 2;
        const rc = AIRFIELD.codes[code].turnRadiusM;
        const node = geo.nodes.get(0);
        expect(node?.kind).toBe('junction');
        if (!node) return;

        // One valid polygon, with the plain strips joining the junction cleanly.
        const pave = mergedFill(geo.fills);
        expect(pave.length).toBe(1);
        for (const r of pave[0]) expect(validRing(r)).toBe(true);

        expect(node.fillets.length).toBeGreaterThan(0);
        for (const f of node.fillets) {
          expect(f.f.r).toBeCloseTo(rc, 6);
          const line = filletLine(f.f);
          for (const [armIdx, end, next] of [[f.armA, line[0], line[1]], [f.armB, line[line.length - 1], line[line.length - 2]]] as const) {
            const arm = node.arms[armIdx];
            // The curve ends on the arm centerline.
            expect(Math.abs(-end.x * arm.dy + end.y * arm.dx)).toBeLessThan(0.05);
            // And leaves it tangentially: the radius at the end is square to the arm.
            const rx = end.x - f.f.cx;
            const ry = end.y - f.f.cy;
            const cos = Math.abs(rx * arm.dx + ry * arm.dy) / Math.hypot(rx, ry);
            expect(Math.asin(Math.min(1, cos)) / DEG).toBeLessThan(0.5);
            void next;
          }
          // The inner pavement edge of the turn is a circle of radius rc - hw about the same center.
          const mid = f.f.a0 + f.f.sweep / 2;
          const inner = { x: f.f.cx + Math.cos(mid) * (rc - hw), y: f.f.cy + Math.sin(mid) * (rc - hw) };
          expect(distToRings(inner, pave)).toBeLessThan(0.05);
        }
      });
    }
  }
});

describe('node kinds', () => {
  it('a bend is one curve with true parallel edges', () => {
    const graph: PaveGraph = {
      nodes: [{ id: 0, x: 0, y: 0 }, { id: 1, x: -300, y: 0 }, { id: 2, x: 300 * Math.cos(35 * DEG), y: -300 * Math.sin(35 * DEG) }],
      edges: [0, 1].map((i) => ({ id: i, a: 0, b: i + 1, hw: 7.5, code: 'C' as const, surface: 'asphalt' as const, kind: 'taxiway' as const, closed: false })),
    };
    const geo = buildPavement(graph);
    const n = geo.nodes.get(0);
    expect(n?.kind).toBe('bend');
    expect(n?.fillets.length).toBe(1);
    const pave = mergedFill(geo.fills);
    expect(pave.length).toBe(1);
    expect(pave[0].length).toBe(1);
    const f = n?.fillets[0].f;
    if (!f) return;
    const mid = f.a0 + f.sweep / 2;
    for (const r of [f.r - 7.5, f.r + 7.5]) expect(distToRings({ x: f.cx + Math.cos(mid) * r, y: f.cy + Math.sin(mid) * r }, pave)).toBeLessThan(0.05);
  });

  it('a nearly straight node gets no curve', () => {
    const geo = buildPavement(star([0, Math.PI + 0.5 * DEG]));
    expect(geo.nodes.get(0)?.kind).toBe('straight');
    expect(geo.nodes.get(0)?.fillets.length).toBe(0);
    expect(mergedFill(geo.fills).length).toBe(1);
  });

  it('a T keeps the main centerline straight through and forks the stem', () => {
    const geo = buildPavement(star([0, Math.PI, 1.5 * Math.PI]));
    const n = geo.nodes.get(0);
    expect(n?.fillets.length).toBe(2);
    const through = n?.arms.filter((a) => a.through) ?? [];
    expect(through.length).toBe(2);
    for (const a of through) expect(a.start).toBe(0);
    const stem = n?.arms.find((a) => !a.through);
    expect(stem?.start).toBeCloseTo(AIRFIELD.codes.C.turnRadiusM, 2);
  });

  it('two junctions closer than their turns merge into one cluster', () => {
    const graph: PaveGraph = {
      nodes: [{ id: 0, x: 0, y: 0 }, { id: 1, x: 20, y: 0 }, { id: 2, x: -300, y: 0 }, { id: 3, x: 320, y: 0 }, { id: 4, x: 0, y: 300 }, { id: 5, x: 20, y: -300 }],
      edges: [
        [0, 1],
        [2, 0],
        [1, 3],
        [0, 4],
        [1, 5],
      ].map(([a, b], i) => ({ id: i, a, b, hw: 7.5, code: 'C' as const, surface: 'asphalt' as const, kind: 'taxiway' as const, closed: false })),
    };
    const geo = buildPavement(graph);
    expect(geo.clusters.some((c) => c.includes(0) && c.includes(1))).toBe(true);
    expect(mergedFill(geo.fills).length).toBe(1);
  });
});

describe('pavement robustness', () => {
  it('random junctions with mixed codes, short arms and tight angles always build', () => {
    const rand = lcg(7);
    const codes = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
    for (let k = 0; k < 400; k++) {
      const n = 2 + Math.floor(rand() * 5);
      const nodes = [{ id: 0, x: rand() * 50, y: rand() * 50 }];
      const edges = [];
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const L = 15 + rand() * 300;
        const code = codes[Math.floor(rand() * 6)];
        nodes.push({ id: i + 1, x: nodes[0].x + Math.cos(a) * L, y: nodes[0].y + Math.sin(a) * L });
        const out = rand() < 0.5;
        edges.push({ id: i, a: out ? 0 : i + 1, b: out ? i + 1 : 0, hw: AIRFIELD.codes[code].taxiwayWidthM / 2, code, surface: 'asphalt' as const, kind: 'taxiway' as const, closed: false });
      }
      const geo = buildPavement({ nodes, edges });
      const pave = mergedFill(geo.fills);
      for (const r of pave[0]) expect(validRing(r)).toBe(true);
    }
  }, 60000);
});
