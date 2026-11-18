import { describe, expect, it } from 'vitest';
import { AIRFIELD, GROUND, STAND_SIZES } from '@data/index';
import { ACCEPT_COMMERCIAL, type AirfieldPayload, type Stand, type Taxiway } from '@shared/airfield';
import { buildRoadGraph, crossingHoldM, depotExit, lanePolyline, pathTo, routeFromDepots, standRoadAnchors, EDGE_LANE } from '@shared/roadGraph';

function payload(p: Partial<AirfieldPayload>): AirfieldPayload {
  return { version: 0, runways: [], taxiways: [], aprons: [], stands: [], holding: [], entries: [], ...p };
}

function stand(id: number, x: number, y: number, type: Stand['type'] = 'contact'): Stand {
  return { id, cost: 0, number: String(id), x, y, headingDeg: 0, type, size: 'medium', code: 'C', surface: 'concrete', pushback: 'auto', accepts: ACCEPT_COMMERCIAL };
}

describe('road graph', () => {
  it('joins the road strips of abutting contact stands into one lane', () => {
    const w = STAND_SIZES.medium.widthM;
    const g = buildRoadGraph(payload({ stands: [stand(1, 0, 0), stand(2, w, 0)] }));
    const a = standRoadAnchors(stand(1, 0, 0));
    expect(a?.ends).not.toBeNull();
    // Two strips of two edges each, sharing the middle end node.
    expect(g.edgeA.length).toBe(4);
    expect(g.edgeKind.every((k) => k === EDGE_LANE)).toBe(true);
    expect(g.nodeX.length).toBe(5);
  });

  it('routes from a depot along a drawn road to a remote stand', () => {
    const s = stand(1, 0, 0, 'remote');
    const conn = standRoadAnchors(s)!.conn;
    const depot = { id: 9, cost: 0, x: 300, y: conn.y - 200, headingDeg: 180 };
    const exit = depotExit(depot);
    const roads = [{ id: 5, cost: 0, points: [exit, { x: exit.x, y: conn.y }, conn] }];
    const g = buildRoadGraph(payload({ stands: [s], depots: [depot], roads }));
    const r = routeFromDepots(g);
    const path = pathTo(r, g.standConn[0]);
    expect(path).not.toBeNull();
    expect(path![0]).toBe(g.depotNode[0]);
    expect(path![path!.length - 1]).toBe(g.standConn[0]);
    expect(r.depot[g.standConn[0]]).toBe(0);
  });

  it('leaves a stand with no road unreached', () => {
    const s = stand(1, 0, 0, 'remote');
    const g = buildRoadGraph(payload({ stands: [s], depots: [{ id: 9, cost: 0, x: 500, y: 500, headingDeg: 0 }] }));
    expect(pathTo(routeFromDepots(g), g.standConn[0])).toBeNull();
  });

  it('puts a crossing node where a road crosses a taxiway centerline', () => {
    const tw = { id: 7, points: [{ x: -100, y: 50 }, { x: 100, y: 50 }] } as Taxiway;
    const roads = [{ id: 1, cost: 0, points: [{ x: 0, y: 0 }, { x: 0, y: 100 }] }];
    const g = buildRoadGraph(payload({ taxiways: [tw], roads }));
    const k = g.nodeCross.indexOf(7);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(g.nodeY[k]).toBeCloseTo(50, 6);
    expect(g.edgeA.length).toBe(2);
  });

  it('holds vehicles clear of the crossed taxiway and its paved shoulders', () => {
    const c = AIRFIELD.codes.C;
    const paved = { widthM: c.taxiwayWidthM, code: 'C', surface: 'asphalt' } as const;
    expect(crossingHoldM(paved)).toBeCloseTo(c.taxiwayWidthM / 2 + c.taxiwayShoulderM + GROUND.crossing.holdBackM, 9);
    expect(crossingHoldM({ ...paved, surface: 'grass' })).toBeCloseTo(c.taxiwayWidthM / 2 + GROUND.crossing.holdBackM, 9);
  });

  it('splits a road where another road ends on it', () => {
    const roads = [
      { id: 1, cost: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 2, cost: 0, points: [{ x: 40, y: 0 }, { x: 40, y: 60 }] },
    ];
    const g = buildRoadGraph(payload({ roads }));
    expect(g.edgeA.length).toBe(3);
    expect(Math.max(...g.nodeDegree)).toBe(3);
  });

  it('keeps vehicles right of the centerline', () => {
    const roads = [{ id: 1, cost: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }];
    const g = buildRoadGraph(payload({ roads }));
    const east = lanePolyline(g, [0, 1]);
    // Screen axes, y down: right of an eastbound vehicle is +y.
    expect(east[0].y).toBeCloseTo(GROUND.road.laneOffsetM, 6);
    const west = lanePolyline(g, [1, 0]);
    expect(west[0].y).toBeCloseTo(-GROUND.road.laneOffsetM, 6);
  });

  it('builds the same graph twice', () => {
    const roads = [{ id: 1, cost: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 30 }, { x: 140, y: 90 }] }];
    const p = payload({ roads, stands: [stand(1, 60, 200)] });
    expect(JSON.stringify(buildRoadGraph(p))).toBe(JSON.stringify(buildRoadGraph(p)));
  });
});
