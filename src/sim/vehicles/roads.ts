import { GROUND, STAND_MARKINGS } from '@data/index';
import type { AirfieldPayload } from '@shared/airfield';
import { buildRoadGraph, crossingHoldM, edgeBetween, hasRoadStrip, routeFrom, edgeSpeedMps, lanePolyline, pathTo, routeFromDepots, type RoadGraph } from '@shared/roadGraph';
import type { TaxiNetwork } from '../airfield/network';

/** Distance before a plain junction where a vehicle must hold the node, in meters. */
const JUNCTION_HOLD_M = 6;
/** Game seconds per tick (hard rule 3). */
const TICK_S = 0.1;

/**
 * The service road graph as the vehicles use it (T60): one inbound and one outbound lane polyline per
 * stand from its serving depot, built once per airfield change, so no vehicle ever searches a path in
 * the tick (hard rule 7). Junction and crossing nodes are reserved by one vehicle at a time, and a
 * crossing node also waits for aircraft on the crossed taxiway section. Derived, never saved.
 */
export class RoadNet {
  graph: RoadGraph = buildRoadGraph({ version: 0, runways: [], taxiways: [], aprons: [], stands: [], holding: [], entries: [] });
  /** Stands the routes were built for; route index s is the depot route of stand s, standCount + s its catering unit route. */
  standCount = 0;
  /** Per route index: 1 when a depot (or, past standCount, a catering unit) reaches the stand's connection point. */
  standRoad = new Uint8Array(0);
  /** Per stand index: meters from the connection point back to the stand's top edge. */
  connDepthM = new Float64Array(0);
  /** Per stand index: the serving depot index, or -1. */
  standDepot = new Int32Array(0);
  /** Lane points of every route, flat. */
  ptX = new Float64Array(0);
  ptY = new Float64Array(0);
  /** Graph node of each lane point. */
  ptNode = new Int32Array(0);
  /** Meters per tick from each lane point to the next. */
  ptStep = new Float64Array(0);
  /** First point and point count of the inbound (depot to stand) and outbound route per stand. */
  inStart = new Int32Array(0);
  inLen = new Int32Array(0);
  outStart = new Int32Array(0);
  outLen = new Int32Array(0);
  /** Vehicle holding each node, or -1. */
  nodeOwner = new Int32Array(0);
  /** Distance before the node at which a vehicle's front must hold it, 0 when the node needs no reservation. */
  nodeHoldM = new Float64Array(0);
  /** Network edges of the crossed taxiway section, as a mark per edge, for each crossing node (crossMark[k], k from nodeCrossSlot). */
  nodeCrossSlot = new Int32Array(0);
  crossMark: Uint8Array[] = [];
  /** Bumped on every rebuild, so vehicles drop routes from an older build. */
  version = 0;

  rebuild(af: AirfieldPayload, net: TaxiNetwork): void {
    const g = buildRoadGraph(af);
    this.graph = g;
    const nS = af.stands.length;
    // Route sets: index s for the depot route of stand s, nS + s for its route from the nearest catering unit (T65).
    const sets = [routeFromDepots(g), routeFrom(g, g.buildingNode.filter((_, i) => af.buildings![i].kind === 'catering'))];
    this.standCount = nS;
    this.standRoad = new Uint8Array(2 * nS);
    this.standDepot = new Int32Array(2 * nS).fill(-1);
    this.connDepthM = new Float64Array(nS);
    for (let s = 0; s < nS; s++) this.connDepthM[s] = hasRoadStrip(af.stands[s]) ? STAND_MARKINGS.serviceRoadM / 2 : GROUND.road.widthM / 2;
    this.inStart = new Int32Array(2 * nS);
    this.inLen = new Int32Array(2 * nS);
    this.outStart = new Int32Array(2 * nS);
    this.outLen = new Int32Array(2 * nS);
    const xs: number[] = [];
    const ys: number[] = [];
    const nodes: number[] = [];
    const steps: number[] = [];
    const push = (path: readonly number[]): void => {
      const line = lanePolyline(g, path);
      for (let i = 0; i < path.length; i++) {
        xs.push(line[i].x);
        ys.push(line[i].y);
        nodes.push(path[i]);
        steps.push(i + 1 < path.length ? edgeSpeedMps(g.edgeKind[edgeBetween(g, path[i], path[i + 1])]) * TICK_S : 0);
      }
    };
    for (let r = 0; r < 2 * nS; r++) {
      const routes = sets[r < nS ? 0 : 1];
      const s = r % nS;
      const path = pathTo(routes, g.standConn[s]);
      if (!path || path.length < 2) continue;
      this.standRoad[r] = 1;
      this.standDepot[r] = routes.depot[g.standConn[s]];
      this.inStart[r] = xs.length;
      this.inLen[r] = path.length;
      push(path);
      this.outStart[r] = xs.length;
      this.outLen[r] = path.length;
      push(path.slice().reverse());
    }
    this.ptX = Float64Array.from(xs);
    this.ptY = Float64Array.from(ys);
    this.ptNode = Int32Array.from(nodes);
    this.ptStep = Float64Array.from(steps);
    const nN = g.nodeX.length;
    this.nodeOwner = new Int32Array(nN).fill(-1);
    this.nodeHoldM = new Float64Array(nN);
    this.nodeCrossSlot = new Int32Array(nN).fill(-1);
    this.crossMark = [];
    for (let n = 0; n < nN; n++) {
      const tw = g.nodeCross[n];
      if (tw >= 0) {
        const t = af.taxiways.find((x) => x.id === tw);
        // The painted hold line, clear of the taxiway and its shoulders, as roadPaint draws it.
        this.nodeHoldM[n] = crossingHoldM(t);
        const mark = new Uint8Array(net.edgeCount);
        for (let e = 0; e < net.edgeCount; e++) if (net.edgeSource[e] === tw) mark[e] = 1;
        this.nodeCrossSlot[n] = this.crossMark.length;
        this.crossMark.push(mark);
      } else if (g.nodeDegree[n] >= 3) {
        this.nodeHoldM[n] = JUNCTION_HOLD_M;
      }
    }
    this.version++;
  }

  /** Releases every node a vehicle holds. */
  releaseAll(v: number): void {
    const o = this.nodeOwner;
    for (let n = 0; n < o.length; n++) if (o[n] === v) o[n] = -1;
  }
}
