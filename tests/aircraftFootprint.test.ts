import { describe, expect, it } from 'vitest';
import raw from '@data/aircraft/aircraft.mvp.json';
import { AIRCRAFT } from '@data/aircraft';
import { aircraftBoundary, footprintClash, footprintSpecSchema, toAircraftLocal, vehiclesTouch, type FootprintSpec, type Poly } from '../src/shared/aircraftFootprint';
import { pointInPolygon, type Pt } from '../src/shared/geom';

const bases = raw.spriteBases as Record<string, unknown>;

function specOf(id: string): FootprintSpec {
  const a = AIRCRAFT.find((t) => t.id === id);
  if (!a) throw new Error(`no aircraft ${id}`);
  return footprintSpecSchema.parse(bases[a.sprite.base]);
}

function rect(x0: number, y0: number, x1: number, y1: number): Poly {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Centre of a 1 m box inside the wing planform at the given lateral offset, found by scanning along the fuselage. */
function wingProbe(wing: Poly, lateral: number): number {
  for (let y = 0; y < 80; y += 0.1) {
    if (pointInPolygon(lateral, y, wing) && pointInPolygon(lateral, y + 0.5, wing) && pointInPolygon(lateral, y - 0.5, wing)) return y;
  }
  throw new Error('no wing point found');
}

describe('aircraft hard footprint', () => {
  it('has fuselage, gear and engine boxes for every MVP 1 type', () => {
    for (const a of AIRCRAFT) {
      const spec = specOf(a.id);
      const { hard } = aircraftBoundary(spec);
      const engineBoxes = spec.engines.reduce((n, e) => n + (e.kind === 'prop' ? 4 : 2), 0);
      const gearBoxes = spec.gear ? 3 : 0;
      expect(hard.length, a.id).toBe(1 + gearBoxes + engineBoxes);
    }
  });

  it('twin jets have fuselage, nose gear, two main gear and two engine boxes', () => {
    const twinJets = AIRCRAFT.filter((a) => a.engines.type === 'turbofan');
    expect(twinJets.length).toBeGreaterThan(0);
    for (const a of twinJets) {
      expect(aircraftBoundary(specOf(a.id)).hard.length, a.id).toBe(6);
    }
  });

  it('wing polygon is symmetric', () => {
    for (const a of AIRCRAFT) {
      const wing = aircraftBoundary(specOf(a.id)).over[0].poly;
      for (const p of wing) {
        const mirror = wing.some((q) => Math.abs(q.x + p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9);
        expect(mirror, `${a.id} vertex ${p.x},${p.y}`).toBe(true);
      }
    }
  });

  it('a 2 m box at the nose gear position clashes', () => {
    const spec = specOf('a320neo');
    const { hard, over } = aircraftBoundary(spec);
    const ny = spec.gear?.nose ?? 0;
    const truck = { poly: rect(-1, ny - 1, 1, ny + 1), heightM: 2, docks: false };
    expect(footprintClash(hard, over, truck)).not.toBeNull();
  });

  it('a main gear box clashes at the track and clears 0.6 m outside it', () => {
    const spec = specOf('b737_800');
    const gear = spec.gear;
    if (!gear) throw new Error('b737_800 has gear');
    const { hard, over } = aircraftBoundary(spec);
    const wheelY = gear.nose + gear.wheelbase;
    const onWheel = { poly: rect(gear.track / 2 - 0.5, wheelY - 0.5, gear.track / 2 + 0.5, wheelY + 0.5), heightM: 0.5, docks: false };
    expect(footprintClash(hard, over, onWheel)).not.toBeNull();
    // The main gear box reaches track / 2 + 0.9. The 0.5 m clearance buffer reaches 0.54 m further,
    // so a box starting 0.6 m past the gear box edge is clear. The probe sits ahead of the engine.
    const edge = gear.track / 2 + 0.9 + 0.6;
    const clear = { poly: rect(edge, wheelY - 0.5, edge + 0.5, wheelY + 0.5), heightM: 0.5, docks: false };
    expect(footprintClash(hard, over, clear)).toBeNull();
  });

  it('fan engine box clashes inside its fore and aft edges and clears 0.6 m beyond them', () => {
    const spec = specOf('b737_800');
    const e = spec.engines[0];
    const { hard, over } = aircraftBoundary(spec);
    const aft = e.x + 1.15 * e.len;
    const fore = e.x - 0.1 * e.len;
    const probe = (lateral: number, y0: number, y1: number) => ({ poly: rect(lateral - 0.2, y0, lateral + 0.2, y1), heightM: 0.5, docks: false });
    for (const sg of [1, -1]) {
      const lateral = sg * e.y;
      expect(footprintClash(hard, over, probe(lateral, aft - 0.5, aft - 0.1)), `aft inside ${sg}`).not.toBeNull();
      expect(footprintClash(hard, over, probe(lateral, aft + 0.6, aft + 1.2)), `aft clear ${sg}`).toBeNull();
      expect(footprintClash(hard, over, probe(lateral, fore - 1.5, fore - 0.6)), `fore clear ${sg}`).toBeNull();
      expect(footprintClash(hard, over, probe(lateral, fore + 0.1, fore + 0.5)), `fore inside ${sg}`).not.toBeNull();
    }
  });

  it('turboprop disc box and propeller bar clash and clear on both engines alike', () => {
    const spec = specOf('atr72_600');
    const e = spec.engines[0];
    if (e.kind !== 'prop' || e.prop_d === undefined) throw new Error('at76 has a propeller');
    const { hard, over } = aircraftBoundary(spec);
    const probe = (lateral: number, y0: number, y1: number) => ({ poly: rect(lateral - 0.1, y0, lateral + 0.1, y1), heightM: 0.5, docks: false });
    const bar = e.x - 0.2;
    const results = [1, -1].map((sg) => ({
      inside: footprintClash(hard, over, probe(sg * e.y, bar - 0.1, bar + 0.1)) !== null,
      clear: footprintClash(hard, over, probe(sg * e.y, e.x - 2.5, e.x - 2.0)) === null,
    }));
    for (const r of results) {
      expect(r.inside).toBe(true);
      expect(r.clear).toBe(true);
    }
  });

  it('mirrored engine boxes are symmetric about the fuselage', () => {
    const spec = specOf('b737_800');
    const { hard } = aircraftBoundary(spec);
    const key = (p: Pt): string => `${p.x.toFixed(9)},${p.y.toFixed(9)}`;
    const sorted = (poly: Poly): string[] => poly.map(key).sort();
    const mirror = (poly: Poly): Poly => poly.map((p): Pt => ({ x: -p.x, y: p.y }));
    // hard[0] is the fuselage, hard[1] and hard[2] are the two fan boxes of the single engine entry.
    expect(sorted(mirror(hard[1]))).toEqual(sorted(hard[2]));
  });

  it('a docking vehicle may overlap a hard part by up to 0.8 m2 and no more', () => {
    const hard = [rect(0, 0, 2, 2)];
    // Buffered hard part reaches x = 2.54 m (2 m edge plus the 0.54 m octagon clearance). A 1 m tall strip
    // inside the hard part's y range overlaps by its x width in m2.
    const strip = (x0: number) => ({ poly: rect(x0, 0.5, x0 + 1, 1.5), heightM: 0.5, docks: true });
    expect(footprintClash(hard, [], strip(1.9))).toBeNull();
    expect(footprintClash(hard, [], strip(1.4))).not.toBeNull();
    expect(footprintClash(hard, [], { ...strip(1.9), docks: false })).not.toBeNull();
  });

  it('a non docking vehicle clashes 0.4 m off a hard part and clears 0.6 m off it', () => {
    const hard = [rect(0, 0, 2, 2)];
    const near = { poly: rect(2.4, 0.5, 3.4, 1.5), heightM: 0.5, docks: false };
    const far = { poly: rect(2.6, 0.5, 3.6, 1.5), heightM: 0.5, docks: false };
    expect(footprintClash(hard, [], near)).not.toBeNull();
    expect(footprintClash(hard, [], far)).toBeNull();
  });

  it('maps a world polygon into the aircraft local frame', () => {
    // Nose at the origin heading north (0, 1): aft is local +y, right is local +x.
    const world = [
      { x: 1, y: 0 },
      { x: 0, y: -10 },
    ];
    const local = toAircraftLocal(world, 0, 0, 0, 1);
    expect(local[0].x).toBeCloseTo(1, 9);
    expect(local[0].y).toBeCloseTo(0, 9);
    expect(local[1].x).toBeCloseTo(0, 9);
    expect(local[1].y).toBeCloseTo(10, 9);
  });

  it('a box 5 m beyond the wingtip at the wing station does not clash', () => {
    const spec = specOf('a320neo');
    const { hard, over } = aircraftBoundary(spec);
    const yStation = spec.wing.x + spec.wing.c * 0.5;
    const far = { poly: rect(spec.wing.sb + 5, yStation - 1, spec.wing.sb + 6, yStation + 1), heightM: 3.2, docks: false };
    expect(footprintClash(hard, over, far)).toBeNull();
  });

  it('a 3.2 m tall box under the wing clashes below 3.2 m underside and passes above it', () => {
    const spec = specOf('a320neo');
    const probeY = wingProbe(aircraftBoundary(spec).over[0].poly, spec.wing.sb * 0.6);
    const lateral = spec.wing.sb * 0.6;
    const under = { poly: rect(lateral - 0.5, probeY - 0.5, lateral + 0.5, probeY + 0.5), heightM: 3.2, docks: false };

    const low = aircraftBoundary({ ...spec, heights: { wing: 3.0, stab: 5.4 } });
    expect(footprintClash(low.hard, low.over, under)).not.toBeNull();

    const high = aircraftBoundary({ ...spec, heights: { wing: 3.4, stab: 5.4 } });
    expect(footprintClash(high.hard, high.over, under)).toBeNull();
  });

  it('vehicles 0.2 m apart touch and 0.4 m apart do not', () => {
    const a = { poly: rect(0, 0, 2, 2) };
    expect(vehiclesTouch(a, { poly: rect(2.2, 0, 4.2, 2) })).toBe(true);
    expect(vehiclesTouch(a, { poly: rect(2.4, 0, 4.4, 2) })).toBe(false);
  });
});
