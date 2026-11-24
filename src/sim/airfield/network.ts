import { CODES, codeIndex, type AirfieldPayload, type CodeLetter, type Surface } from '@shared/airfield';
import { AIRFIELD } from '@data/index';
import { atan2Det } from '@shared/trig';
import { roundCorners } from '@shared/pavement/fillet';
import { closestOnSegment, segmentIntersection, type Pt } from '@shared/geom';
import { nearestOnLines, standForks, standLeadOut } from '@shared/standFork';

export const EdgeKind = { Taxiway: 0, Taxilane: 1, RapidExit: 2, Runway: 3, StandLeadIn: 4, StandFork: 5, StandLeadOut: 6 } as const;
/** Taxiway, taxilane and rapid exit edges: the ones aircraft taxi along under their own power. */
export const isTaxiEdge = (k: number): boolean => k === EdgeKind.Taxiway || k === EdgeKind.Taxilane || k === EdgeKind.RapidExit;
export const SAMPLE_M = 2;
const MERGE_M = 3.5;
const SNAP_M = 7;
const SURFACE_INDEX: Record<Surface, number> = { dirt: 0, gravel: 1, grass: 2, asphalt: 3, concrete: 4 };
export const surfaceIndex = (s: Surface): number => SURFACE_INDEX[s];

interface Line {
  /** Source: kind of object and its id. */
  edgeKind: number;
  sourceId: number;
  /** The taxiway line a section belongs to (T71), else the source id. Blocks and junction conflicts group by it. */
  lineId: number;
  pts: Pt[];
  oneWay: boolean;
  preferred: number;
  closed: boolean;
  maxCode: number;
  speedMs: number;
  pcr: number;
  surface: number;
  runwayId: number;
  /** Stand index for lead in lines, else -1. */
  standIdx: number;
  /** Stand index for fork arcs (0 left, 1 right) and lead out lines, else -1. */
  forkStand: number;
  forkSide: number;
  /** Bend radius of a taxiway line, or 0 where its bends stay sharp (T84). */
  turnR?: number;
}

/** Arc point spacing of the bends inside an edge, finer than the 2 m movement samples. */
const BEND_STEP_M = 1;
/** Bends tighter than the half width plus this cannot be laid, as in `buildNode` (`pavement.ts`). */
const MIN_RADIUS_MARGIN_M = 0.5;

/** The centerline bend radius of a taxiway of this code and width, or 0 when the pavement draws a sharp corner. */
function bendRadius(code: CodeLetter, widthM: number): number {
  const r = AIRFIELD.codes[code].turnRadiusM;
  return r < widthM / 2 + MIN_RADIUS_MARGIN_M ? 0 : r;
}

const isStandLine = (l: Line): boolean => l.edgeKind === EdgeKind.StandLeadIn || l.edgeKind === EdgeKind.StandFork || l.edgeKind === EdgeKind.StandLeadOut;

/** Where aircraft hold before a runway entry. */
export interface HoldInfo {
  entryIdx: number;
  node: number;
  /** Edge the aircraft arrives on and the distance along it where it stops. */
  edge: number;
  dir: number;
  dist: number;
  holdDist: number;
}

/**
 * The taxi network as flat typed arrays, built from the airfield whenever it changes
 * (docs/ARCHITECTURE.md section 5.1). Nodes are junctions, ends, stand points and runway
 * entries. Edges are maximal chains between nodes, with samples every 2 m for movement.
 * Runway centerlines are part of the graph for geometry but routing never uses them.
 */
export class TaxiNetwork {
  nodeCount = 0;
  nodeX = new Float64Array(0);
  nodeY = new Float64Array(0);
  /** 1 for nodes lying on a runway centerline. */
  nodeOnRunway = new Uint8Array(0);

  edgeCount = 0;
  edgeFrom = new Int32Array(0);
  edgeTo = new Int32Array(0);
  edgeLen = new Float64Array(0);
  edgeSpeed = new Float64Array(0);
  edgeMaxCode = new Uint8Array(0);
  edgeOneWay = new Uint8Array(0);
  edgePreferred = new Int8Array(0);
  edgeClosed = new Uint8Array(0);
  edgeKind = new Uint8Array(0);
  edgePcr = new Float32Array(0);
  edgeSurface = new Uint8Array(0);
  edgeStand = new Int32Array(0);
  /** Stand index for fork arcs, else -1, and the side: 0 left, 1 right as seen from the parked aircraft. */
  edgeForkStand = new Int32Array(0);
  edgeForkSide = new Int8Array(0);
  edgeSource = new Int32Array(0);
  /** Line id per edge: the taxiway a section belongs to (T71), else the source id. */
  edgeLine = new Int32Array(0);
  /**
   * Reservation block per edge, or -1 for runway, one way and stand edges. A block is a run of two way taxi edges
   * between junctions (T87): a node where anything but two such edges meet, a stand joins or a one way or runway
   * edge starts ends the run. Aircraft claim every block of a run on their route at once.
   */
  edgeBlock = new Int32Array(0);
  /** Direction of each edge inside its block: +1 when from to runs the block's way, else -1. */
  edgeBlockSign = new Int8Array(0);
  blockTotal = 0;
  /** Center distance an aircraft holds short of a node, minus its half length: the largest taxiway object distance of the taxi edges there. */
  nodeHoldM = new Float32Array(0);
  /**
   * Conflict sets in compressed form: the edges that conflict with edge e are
   * conflictEdge[conflictStart[e] .. conflictStart[e + 1]). Only taxiway, taxilane and rapid exit edges take part.
   * Two edges of different taxiways conflict when, near a junction, their wingtip envelopes overlap.
   */
  conflictStart = new Int32Array(1);
  conflictEdge = new Int32Array(0);
  /** Radius around a junction inside which an aircraft on a conflicting edge blocks entry: the code's taxiway separation. */
  edgeZoneM = new Float32Array(0);
  edgeSampleStart = new Int32Array(0);
  edgeSampleCount = new Int32Array(0);
  sampleX = new Float32Array(0);
  sampleY = new Float32Array(0);
  sampleH = new Float32Array(0);

  adjStart = new Int32Array(0);
  adjEdge = new Int32Array(0);
  /** +1 when leaving the node along the edge, -1 when traversing it backward. */
  adjDir = new Int8Array(0);

  standNode: Int32Array = new Int32Array(0);
  /** 1 for a pass through stand with a lead out (T72), which departs forward. */
  standOut: Uint8Array = new Uint8Array(0);
  standEdge: Int32Array = new Int32Array(0);
  /** Fork node per stand, and the arc edge per stand and side (index stand * 2 + side) that ends at it. */
  forkNode: Int32Array = new Int32Array(0);
  forkEdge: Int32Array = new Int32Array(0);
  /** Unit direction along the taxilane away from the fork at each arc end (index stand * 2 + side). */
  forkAwayX: Float64Array = new Float64Array(0);
  forkAwayY: Float64Array = new Float64Array(0);
  entryNode: Int32Array = new Int32Array(0);
  holds: HoldInfo[] = [];

  version = 0;

  // A* scratch, allocated once per build.
  private g = new Float64Array(0);
  private cameEdge = new Int32Array(0);
  private cameDir = new Int8Array(0);
  private closed = new Uint8Array(0);
  private heap = new Int32Array(0);
  private heapPos = new Int32Array(0);
  private heapSize = 0;
  private f = new Float64Array(0);
  /** Extra cost per edge from current traffic, refreshed every 50 ticks. */
  congestion = new Float64Array(0);
  private maxSpeed = 15;

  static build(af: AirfieldPayload, version: number): TaxiNetwork {
    const net = new TaxiNetwork();
    net.version = version;
    net.construct(af);
    return net;
  }

  private construct(af: AirfieldPayload): void {
    const lines: Line[] = [];
    for (const t of af.taxiways) {
      lines.push({
        edgeKind: t.kind === 'taxilane' ? EdgeKind.Taxilane : t.kind === 'rapidExit' ? EdgeKind.RapidExit : EdgeKind.Taxiway,
        sourceId: t.id,
        lineId: t.line ?? t.id,
        pts: t.points.map((p) => ({ x: p.x, y: p.y })),
        oneWay: t.oneWay,
        preferred: t.preferred ?? 0,
        // Works close the taxiway until they finish.
        closed: t.closed || t.works !== undefined,
        maxCode: codeIndex(t.maxCode),
        speedMs: t.speedKmh / 3.6,
        pcr: t.pcr,
        surface: surfaceIndex(t.surface),
        runwayId: -1,
        standIdx: -1,
        forkStand: -1,
        forkSide: -1,
        turnR: bendRadius(t.code, t.widthM),
      });
    }
    // Extend taxiway ends that touch a runway edge to the entry point on the centerline.
    for (const e of af.entries) {
      const line = lines.find((l) => l.edgeKind !== EdgeKind.Runway && l.sourceId === e.taxiwayId && l.standIdx < 0);
      if (!line) continue;
      const first = line.pts[0];
      const last = line.pts[line.pts.length - 1];
      const dFirst = Math.hypot(first.x - e.x, first.y - e.y);
      const dLast = Math.hypot(last.x - e.x, last.y - e.y);
      if (Math.min(dFirst, dLast) < 0.5) continue;
      if (Math.min(dFirst, dLast) > 40) continue;
      if (dFirst <= dLast) line.pts.unshift({ x: e.x, y: e.y });
      else line.pts.push({ x: e.x, y: e.y });
    }
    for (const r of af.runways) {
      lines.push({
        edgeKind: EdgeKind.Runway,
        sourceId: r.id,
        lineId: r.id,
        pts: [{ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y2 }],
        oneWay: false,
        preferred: 0,
        closed: false,
        maxCode: 5,
        speedMs: 100,
        pcr: r.pcr,
        surface: surfaceIndex(r.surface),
        runwayId: r.id,
        standIdx: -1,
        forkStand: -1,
        forkSide: -1,
      });
    }
    // Stand lead ins (docs/DESIGN_REVISION_2.md section 1): the stand centerline from the fork point to the
    // stop point, and two fork arcs that join the taxilane tangentially. Without a taxilane straight behind,
    // a straight lead in runs to the nearest centerline.
    const taxiLines = lines.filter((l) => l.edgeKind !== EdgeKind.Runway);
    const standLine = (s: AirfieldPayload['stands'][number], idx: number, pts: Pt[], kind: number, side: number): Line => ({
      edgeKind: kind,
      sourceId: s.id,
      lineId: s.id,
      pts,
      oneWay: false,
      preferred: 0,
      closed: false,
      maxCode: codeIndex(s.code),
      speedMs: 4,
      pcr: 999,
      surface: surfaceIndex(s.surface),
      runwayId: -1,
      standIdx: kind === EdgeKind.StandLeadIn ? idx : -1,
      forkStand: kind === EdgeKind.StandFork || kind === EdgeKind.StandLeadOut ? idx : -1,
      forkSide: side,
    });
    const forks = standForks(af.stands, taxiLines);
    this.forkAwayX = new Float64Array(af.stands.length * 2);
    this.forkAwayY = new Float64Array(af.stands.length * 2);
    forks.forEach((f, st) => {
      if (!f) return;
      for (const side of [0, 1]) {
        this.forkAwayX[st * 2 + side] = f.away[side].x;
        this.forkAwayY[st * 2 + side] = f.away[side].y;
      }
    });
    af.stands.forEach((s, idx) => {
      const fork = forks[idx];
      if (fork) {
        // From the pavement to the stand, so forward is the way an arriving aircraft drives.
        lines.push(standLine(s, idx, [fork.fork, { x: s.x, y: s.y }], EdgeKind.StandLeadIn, -1));
        fork.arcs.forEach((arc, side) => lines.push(standLine(s, idx, arc.slice().reverse(), EdgeKind.StandFork, side)));
        return;
      }
      const hit = nearestOnLines(s, taxiLines, 150);
      if (hit) lines.push(standLine(s, idx, [hit, { x: s.x, y: s.y }], EdgeKind.StandLeadIn, -1));
    });
    // Lead outs of pass through stands (T72): a stem from the stop point to the out fork and two arcs onto
    // the centerline ahead, driven only forward and only by an aircraft leaving that stand.
    this.standOut = new Uint8Array(af.stands.length);
    af.stands.forEach((s, idx) => {
      const out = forks[idx] ? standLeadOut(s, taxiLines) : null;
      if (!out) return;
      this.standOut[idx] = 1;
      lines.push(standLine(s, idx, [{ x: s.x, y: s.y }, out.fork], EdgeKind.StandLeadOut, -1));
      out.arcs.forEach((arc, side) => lines.push(standLine(s, idx, arc.slice(), EdgeKind.StandLeadOut, side)));
    });

    this.splitCrossings(lines);
    this.snapEnds(lines);
    this.assemble(lines, af);
  }

  /** Runs of two way taxi edges between junctions become blocks, each edge with its direction inside the run (T87). */
  private buildBlocks(): void {
    const E = this.edgeCount;
    this.edgeBlock = new Int32Array(E).fill(-1);
    this.edgeBlockSign = new Int8Array(E);
    this.nodeHoldM = new Float32Array(this.nodeCount);
    const twoWay = (e: number): boolean => isTaxiEdge(this.edgeKind[e]) && this.edgeOneWay[e] === 0 && this.edgeFrom[e] !== this.edgeTo[e];
    for (let n = 0; n < this.nodeCount; n++) {
      for (let p = this.adjStart[n]; p < this.adjStart[n + 1]; p++) {
        const e = this.adjEdge[p];
        if (isTaxiEdge(this.edgeKind[e])) this.nodeHoldM[n] = Math.max(this.nodeHoldM[n], AIRFIELD.codes[CODES[this.edgeMaxCode[e]]].taxiObjectM);
      }
    }
    // The other edge of a node where exactly two two way taxi edges meet and nothing else, else -1.
    const through = (n: number, e: number): number => {
      if (this.adjStart[n + 1] - this.adjStart[n] !== 2) return -1;
      for (let p = this.adjStart[n]; p < this.adjStart[n + 1]; p++) {
        const f = this.adjEdge[p];
        if (f !== e) return twoWay(f) ? f : -1;
      }
      return -1;
    };
    const stack: number[] = [];
    let b = 0;
    for (let e0 = 0; e0 < E; e0++) {
      if (!twoWay(e0) || this.edgeBlock[e0] >= 0) continue;
      this.edgeBlock[e0] = b;
      this.edgeBlockSign[e0] = 1;
      stack.push(e0);
      while (stack.length > 0) {
        const e = stack.pop() as number;
        const ahead = this.edgeBlockSign[e] === 1 ? this.edgeTo[e] : this.edgeFrom[e];
        for (const n of [this.edgeFrom[e], this.edgeTo[e]]) {
          const f = through(n, e);
          if (f < 0 || this.edgeBlock[f] >= 0) continue;
          this.edgeBlock[f] = b;
          // Past the node the block runs on away from it; behind the node it runs into it.
          this.edgeBlockSign[f] = n === ahead ? (this.edgeFrom[f] === n ? 1 : -1) : this.edgeTo[f] === n ? 1 : -1;
          stack.push(f);
        }
      }
      b++;
    }
    this.blockTotal = b;
  }

  /** Inserts shared vertices where two lines cross. */
  private splitCrossings(lines: Line[]): void {
    const inserts = new Map<string, { t: number; x: number; y: number }[]>();
    const key = (li: number, si: number): string => `${li}:${si}`;
    for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        // Stand lines never join each other: neighbouring forks may cross near the taxilane.
        if (isStandLine(lines[a]) && isStandLine(lines[b])) continue;
        for (let i = 1; i < lines[a].pts.length; i++) {
          for (let j = 1; j < lines[b].pts.length; j++) {
            const pa = lines[a].pts[i - 1];
            const pb = lines[a].pts[i];
            const pc = lines[b].pts[j - 1];
            const pd = lines[b].pts[j];
            const t = segmentIntersection(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y, pd.x, pd.y);
            if (t < 0) continue;
            const x = pa.x + (pb.x - pa.x) * t;
            const y = pa.y + (pb.y - pa.y) * t;
            const u = Math.hypot(x - pc.x, y - pc.y) / (Math.hypot(pd.x - pc.x, pd.y - pc.y) || 1);
            const add = (k: string, tt: number): void => {
              const l = inserts.get(k);
              if (l) l.push({ t: tt, x, y });
              else inserts.set(k, [{ t: tt, x, y }]);
            };
            add(key(a, i - 1), t);
            add(key(b, j - 1), u);
          }
        }
      }
    }
    for (let li = 0; li < lines.length; li++) {
      const out: Pt[] = [];
      const pts = lines[li].pts;
      for (let i = 0; i < pts.length; i++) {
        out.push(pts[i]);
        const list = inserts.get(key(li, i));
        if (list && i < pts.length - 1) {
          list.sort((p, q) => p.t - q.t);
          for (const ins of list) out.push({ x: ins.x, y: ins.y });
        }
      }
      lines[li].pts = out;
    }
  }

  /** Moves line ends that nearly touch another line onto it, adding a shared vertex there (T junctions). */
  private snapEnds(lines: Line[]): void {
    const c = { x: 0, y: 0, t: 0 };
    for (let li = 0; li < lines.length; li++) {
      for (const endIdx of [0, lines[li].pts.length - 1]) {
        const p = lines[li].pts[endIdx];
        let best = SNAP_M;
        let target = -1;
        let seg = -1;
        let at: Pt | null = null;
        for (let lj = 0; lj < lines.length; lj++) {
          if (lj === li) continue;
          if (isStandLine(lines[li]) && isStandLine(lines[lj])) continue;
          const other = lines[lj].pts;
          for (let i = 1; i < other.length; i++) {
            closestOnSegment(p.x, p.y, other[i - 1].x, other[i - 1].y, other[i].x, other[i].y, c);
            const d = Math.hypot(p.x - c.x, p.y - c.y);
            if (d < best) {
              // Already at a vertex of the other line: nothing to insert.
              const dv = Math.min(Math.hypot(c.x - other[i - 1].x, c.y - other[i - 1].y), Math.hypot(c.x - other[i].x, c.y - other[i].y));
              if (dv < MERGE_M) continue;
              best = d;
              target = lj;
              seg = i;
              at = { x: c.x, y: c.y };
            }
          }
        }
        if (target >= 0 && at) {
          lines[target].pts.splice(seg, 0, at);
          lines[li].pts[endIdx] = { x: at.x, y: at.y };
        }
      }
    }
  }

  private assemble(lines: Line[], af: AirfieldPayload): void {
    // Merge vertices into nodes.
    const nx: number[] = [];
    const ny: number[] = [];
    const cell = new Map<string, number[]>();
    const nodeFor = (p: Pt): number => {
      const gx = Math.floor(p.x / MERGE_M);
      const gy = Math.floor(p.y / MERGE_M);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = cell.get(`${gx + dx},${gy + dy}`);
          if (!list) continue;
          for (const n of list) if (Math.hypot(nx[n] - p.x, ny[n] - p.y) < MERGE_M) return n;
        }
      }
      const id = nx.length;
      nx.push(p.x);
      ny.push(p.y);
      const k = `${gx},${gy}`;
      const l = cell.get(k);
      if (l) l.push(id);
      else cell.set(k, [id]);
      return id;
    };
    // A node that nothing else merges into, for the inside of fork arcs: neighbouring forks may cross
    // near the taxilane, and only their ends may join the network.
    const privateNode = (p: Pt): number => {
      nx.push(p.x);
      ny.push(p.y);
      return nx.length - 1;
    };
    const ids: number[][] = lines.map((l) => l.pts.map((p, k) => ((l.edgeKind === EdgeKind.StandFork || l.edgeKind === EdgeKind.StandLeadOut) && k > 0 && k < l.pts.length - 1 ? privateNode(p) : nodeFor(p))));
    const seqs: number[][] = ids.map((line) => {
      const seq: number[] = [];
      for (const n of line) if (seq.length === 0 || seq[seq.length - 1] !== n) seq.push(n);
      return seq;
    });
    const degree = new Int32Array(nx.length);
    for (const seq of seqs) {
      for (let i = 0; i < seq.length; i++) degree[seq[i]] += i === 0 || i === seq.length - 1 ? 1 : 2;
    }
    // Chains between nodes where the degree is not two, or where the line ends.
    interface RawEdge {
      from: number;
      to: number;
      pts: Pt[];
      line: Line;
    }
    const raw: RawEdge[] = [];
    seqs.forEach((seq, li) => {
      const line = lines[li];
      if (seq.length < 2) return;
      // Walk the original vertices so curved geometry survives, cutting at junction nodes.
      const own = ids[li];
      let chain: Pt[] = [{ x: nx[seq[0]], y: ny[seq[0]] }];
      let chainFrom = seq[0];
      for (let k = 1; k < line.pts.length; k++) {
        const n = own[k];
        if (n === own[k - 1]) continue;
        chain.push({ x: nx[n], y: ny[n] });
        const isCut = k === line.pts.length - 1 || degree[n] !== 2;
        if (isCut) {
          raw.push({ from: chainFrom, to: n, pts: chain, line });
          chain = [{ x: nx[n], y: ny[n] }];
          chainFrom = n;
        }
      }
      // A line whose last vertices merge into one node skips the cut above, so its tail is flushed
      // here. Without this a taxiway that ends exactly on a runway threshold lost its last stretch.
      if (chain.length > 1) raw.push({ from: chainFrom, to: own[own.length - 1], pts: chain, line });
    });

    this.nodeCount = nx.length;
    this.nodeX = Float64Array.from(nx);
    this.nodeY = Float64Array.from(ny);
    this.nodeOnRunway = new Uint8Array(this.nodeCount);
    this.edgeCount = raw.length;
    const E = raw.length;
    this.edgeFrom = new Int32Array(E);
    this.edgeTo = new Int32Array(E);
    this.edgeLen = new Float64Array(E);
    this.edgeSpeed = new Float64Array(E);
    this.edgeMaxCode = new Uint8Array(E);
    this.edgeOneWay = new Uint8Array(E);
    this.edgePreferred = new Int8Array(E);
    this.edgeClosed = new Uint8Array(E);
    this.edgeKind = new Uint8Array(E);
    this.edgePcr = new Float32Array(E);
    this.edgeSurface = new Uint8Array(E);
    this.edgeStand = new Int32Array(E).fill(-1);
    this.edgeForkStand = new Int32Array(E).fill(-1);
    this.edgeForkSide = new Int8Array(E).fill(-1);
    this.edgeSource = new Int32Array(E);
    this.edgeLine = new Int32Array(E);
    this.edgeBlock = new Int32Array(E).fill(-1);
    this.edgeSampleStart = new Int32Array(E);
    this.edgeSampleCount = new Int32Array(E);

    const sx: number[] = [];
    const sy: number[] = [];
    const sh: number[] = [];
    raw.forEach((r, e) => {
      this.edgeFrom[e] = r.from;
      this.edgeTo[e] = r.to;
      this.edgeSpeed[e] = r.line.speedMs;
      this.edgeMaxCode[e] = r.line.maxCode;
      this.edgeOneWay[e] = r.line.oneWay ? 1 : 0;
      this.edgePreferred[e] = r.line.preferred;
      this.edgeClosed[e] = r.line.closed ? 1 : 0;
      this.edgeKind[e] = r.line.edgeKind;
      this.edgePcr[e] = r.line.pcr;
      this.edgeSurface[e] = r.line.surface;
      this.edgeStand[e] = r.line.standIdx;
      this.edgeForkStand[e] = r.line.forkStand;
      this.edgeForkSide[e] = r.line.forkSide;
      this.edgeSource[e] = r.line.sourceId;
      this.edgeLine[e] = r.line.lineId;
      if (r.line.edgeKind === EdgeKind.Runway) {
        this.nodeOnRunway[r.from] = 1;
        this.nodeOnRunway[r.to] = 1;
      }
      // Bends inside an edge follow the fillet the pavement draws (T84), so aircraft drive the curve
      // instead of the corner point. Nodes stay where they are; only the edge's path changes.
      if (r.line.turnR !== undefined && r.line.turnR > 0 && r.pts.length > 2) r.pts = roundCorners(r.pts, r.line.turnR, BEND_STEP_M);
      // Resample every 2 m.
      let total = 0;
      for (let i = 1; i < r.pts.length; i++) total += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y);
      this.edgeLen[e] = total;
      this.edgeSampleStart[e] = sx.length;
      const n = Math.max(2, Math.ceil(total / SAMPLE_M) + 1);
      this.edgeSampleCount[e] = n;
      let seg = 1;
      let segStart = 0;
      let segLen = Math.hypot(r.pts[1].x - r.pts[0].x, r.pts[1].y - r.pts[0].y);
      for (let k = 0; k < n; k++) {
        const d = n === 1 ? 0 : (total * k) / (n - 1);
        while (d > segStart + segLen && seg < r.pts.length - 1) {
          segStart += segLen;
          seg++;
          segLen = Math.hypot(r.pts[seg].x - r.pts[seg - 1].x, r.pts[seg].y - r.pts[seg - 1].y);
        }
        const a = r.pts[seg - 1];
        const b = r.pts[seg];
        const t = segLen === 0 ? 0 : Math.min(1, (d - segStart) / segLen);
        sx.push(a.x + (b.x - a.x) * t);
        sy.push(a.y + (b.y - a.y) * t);
        sh.push(atan2Det(b.y - a.y, b.x - a.x));
      }
    });
    this.sampleX = Float32Array.from(sx);
    this.sampleY = Float32Array.from(sy);
    this.sampleH = Float32Array.from(sh);

    // Adjacency in compressed form. Runway edges are listed too, routing skips them.
    const counts = new Int32Array(this.nodeCount + 1);
    for (let e = 0; e < E; e++) {
      counts[this.edgeFrom[e] + 1]++;
      counts[this.edgeTo[e] + 1]++;
    }
    for (let i = 0; i < this.nodeCount; i++) counts[i + 1] += counts[i];
    this.adjStart = counts.slice();
    this.adjEdge = new Int32Array(2 * E);
    this.adjDir = new Int8Array(2 * E);
    const fill = counts.slice(0, this.nodeCount);
    for (let e = 0; e < E; e++) {
      let p = fill[this.edgeFrom[e]]++;
      this.adjEdge[p] = e;
      this.adjDir[p] = 1;
      p = fill[this.edgeTo[e]]++;
      this.adjEdge[p] = e;
      this.adjDir[p] = -1;
    }

    this.buildBlocks();

    // Stand and entry nodes.
    this.standNode = new Int32Array(af.stands.length).fill(-1);
    this.standEdge = new Int32Array(af.stands.length).fill(-1);
    for (let e = 0; e < E; e++) {
      if (this.edgeStand[e] >= 0) {
        this.standNode[this.edgeStand[e]] = this.edgeTo[e];
        this.standEdge[this.edgeStand[e]] = e;
      }
    }
    // The fork node of a stand is where its lead in starts, and each fork arc ends there.
    this.forkNode = new Int32Array(af.stands.length).fill(-1);
    this.forkEdge = new Int32Array(af.stands.length * 2).fill(-1);
    for (let st = 0; st < af.stands.length; st++) if (this.standEdge[st] >= 0) this.forkNode[st] = this.edgeFrom[this.standEdge[st]];
    for (let e = 0; e < E; e++) {
      const st = this.edgeForkStand[e];
      if (st >= 0 && this.edgeKind[e] === EdgeKind.StandFork && this.edgeTo[e] === this.forkNode[st]) this.forkEdge[st * 2 + this.edgeForkSide[e]] = e;
    }
    this.entryNode = new Int32Array(af.entries.length).fill(-1);
    af.entries.forEach((en, i) => {
      let best = 12;
      for (let n = 0; n < this.nodeCount; n++) {
        const d = Math.hypot(this.nodeX[n] - en.x, this.nodeY[n] - en.y);
        if (d < best) {
          best = d;
          this.entryNode[i] = n;
        }
      }
    });

    // Holding stops: on the edge arriving at the entry node, holdDist before the node.
    this.holds = [];
    af.entries.forEach((en, i) => {
      const node = this.entryNode[i];
      if (node < 0) return;
      const rwy = af.runways.find((r) => r.id === en.runwayId);
      if (!rwy) return;
      for (let p = this.adjStart[node]; p < this.adjStart[node + 1]; p++) {
        const e = this.adjEdge[p];
        if (this.edgeKind[e] === EdgeKind.Runway || this.edgeKind[e] === EdgeKind.StandLeadIn) continue;
        if (this.edgeSource[e] !== en.taxiwayId) continue;
        // Direction of travel toward the runway: arrive at `node`.
        const dir = this.adjDir[p] === 1 ? -1 : 1;
        if (dir === -1 && this.edgeOneWay[e] === 1) continue;
        // A taxiway that meets the runway twice has a holding point per entry: take the nearest one.
        let holdAt: (typeof af.holding)[number] | undefined;
        let holdBest = Infinity;
        for (const h of af.holding) {
          if (h.runwayId !== en.runwayId || h.taxiwayId !== en.taxiwayId) continue;
          const d = Math.hypot(h.x - en.x, h.y - en.y);
          if (d < holdBest) {
            holdBest = d;
            holdAt = h;
          }
        }
        const holdD = holdAt ? Math.hypot(holdAt.x - en.x, holdAt.y - en.y) : 0;
        this.holds.push({ entryIdx: i, node, edge: e, dir, dist: Math.max(0, this.edgeLen[e] - holdD), holdDist: holdD });
        break;
      }
    });

    this.g = new Float64Array(this.nodeCount);
    this.f = new Float64Array(this.nodeCount);
    this.cameEdge = new Int32Array(this.nodeCount);
    this.cameDir = new Int8Array(this.nodeCount);
    this.closed = new Uint8Array(this.nodeCount);
    this.heap = new Int32Array(this.nodeCount + 1);
    this.heapPos = new Int32Array(this.nodeCount);
    this.buildConflicts();
    this.congestion = new Float64Array(E);
    this.maxSpeed = 1;
    for (let e = 0; e < E; e++) if (this.edgeKind[e] !== EdgeKind.Runway) this.maxSpeed = Math.max(this.maxSpeed, this.edgeSpeed[e]);
  }

  /**
   * Conflict sets (docs/ARCHITECTURE.md section 5.4). For every junction, the edges with a sample within the
   * taxiway separation of the node conflict when two of their samples are closer than the sum of their half
   * envelopes. The half envelope is half the span of the edge's largest code plus half the wingtip clearance,
   * which is half the code's taxiway separation, so two parallel taxiways at the standard separation just clear.
   * Edges of the same taxiway never conflict, the following gap covers them.
   */
  private buildConflicts(): void {
    const E = this.edgeCount;
    const sep = (e: number): number => AIRFIELD.codes[CODES[this.edgeMaxCode[e]]].taxiSepM;
    this.edgeZoneM = new Float32Array(E);
    const takes = new Uint8Array(E);
    for (let e = 0; e < E; e++) {
      const k = this.edgeKind[e];
      if (k === EdgeKind.Taxiway || k === EdgeKind.Taxilane || k === EdgeKind.RapidExit) {
        takes[e] = 1;
        this.edgeZoneM[e] = sep(e);
      }
    }
    const pairs = new Set<number>();
    const near: number[] = [];
    for (let n = 0; n < this.nodeCount; n++) {
      let junction = false;
      let radius = 0;
      let first = -1;
      for (let p = this.adjStart[n]; p < this.adjStart[n + 1]; p++) {
        const e = this.adjEdge[p];
        if (!takes[e]) continue;
        radius = Math.max(radius, sep(e));
        if (first < 0) first = e;
        else if (this.edgeLine[e] !== this.edgeLine[first]) junction = true;
      }
      if (!junction) continue;
      near.length = 0;
      for (let e = 0; e < E; e++) {
        if (!takes[e]) continue;
        const s0 = this.edgeSampleStart[e];
        for (let k = 0; k < this.edgeSampleCount[e]; k++) {
          if (Math.hypot(this.sampleX[s0 + k] - this.nodeX[n], this.sampleY[s0 + k] - this.nodeY[n]) <= radius) {
            near.push(e);
            break;
          }
        }
      }
      for (let a = 0; a < near.length; a++) {
        for (let b = a + 1; b < near.length; b++) {
          const ea = near[a];
          const eb = near[b];
          if (this.edgeLine[ea] === this.edgeLine[eb]) continue;
          const key = ea * E + eb;
          if (pairs.has(key)) continue;
          if (this.envelopesOverlap(ea, eb, n, radius, (sep(ea) + sep(eb)) / 2)) {
            pairs.add(key);
            pairs.add(eb * E + ea);
          }
        }
      }
    }
    const count = new Int32Array(E + 1);
    for (const key of pairs) count[Math.floor(key / E) + 1]++;
    for (let e = 0; e < E; e++) count[e + 1] += count[e];
    this.conflictStart = count.slice();
    this.conflictEdge = new Int32Array(pairs.size);
    const fill = count.slice(0, E);
    const sorted = Array.from(pairs).sort((x, y) => x - y);
    for (const key of sorted) {
      const a = Math.floor(key / E);
      this.conflictEdge[fill[a]++] = key - a * E;
    }
  }

  /** True when a sample of a and a sample of b, both within `radius` of the node, are closer than `limit`. */
  private envelopesOverlap(a: number, b: number, node: number, radius: number, limit: number): boolean {
    const sa = this.edgeSampleStart[a];
    const sb = this.edgeSampleStart[b];
    const nx = this.nodeX[node];
    const ny = this.nodeY[node];
    for (let i = 0; i < this.edgeSampleCount[a]; i++) {
      const ax = this.sampleX[sa + i];
      const ay = this.sampleY[sa + i];
      if (Math.hypot(ax - nx, ay - ny) > radius) continue;
      for (let j = 0; j < this.edgeSampleCount[b]; j++) {
        const bx = this.sampleX[sb + j];
        const by = this.sampleY[sb + j];
        if (Math.hypot(bx - nx, by - ny) > radius) continue;
        if (Math.hypot(ax - bx, ay - by) < limit) return true;
      }
    }
    return false;
  }

  /** Position and heading at a distance along an edge, in travel direction `dir` (+1 forward). */
  pointAt(edge: number, dist: number, out: { x: number; y: number; h: number }): void {
    const start = this.edgeSampleStart[edge];
    const n = this.edgeSampleCount[edge];
    const len = this.edgeLen[edge];
    const f = len === 0 ? 0 : (Math.min(Math.max(dist, 0), len) / len) * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const t = f - i;
    out.x = this.sampleX[start + i] + (this.sampleX[start + i + 1] - this.sampleX[start + i]) * t;
    out.y = this.sampleY[start + i] + (this.sampleY[start + i + 1] - this.sampleY[start + i]) * t;
    out.h = this.sampleH[start + i];
  }

  // A* ---------------------------------------------------------------------

  private heapPush(n: number): void {
    const i = ++this.heapSize;
    this.heap[i] = n;
    this.heapPos[n] = i;
    this.siftUp(i);
  }

  private siftUp(start: number): void {
    let i = start;
    while (i > 1) {
      const p = i >> 1;
      if (this.f[this.heap[p]] <= this.f[this.heap[i]]) break;
      this.swap(i, p);
      i = p;
    }
  }

  private swap(a: number, b: number): void {
    const na = this.heap[a];
    const nb = this.heap[b];
    this.heap[a] = nb;
    this.heap[b] = na;
    this.heapPos[nb] = a;
    this.heapPos[na] = b;
  }

  private heapPop(): number {
    const top = this.heap[1];
    this.swap(1, this.heapSize);
    this.heapSize--;
    let i = 1;
    for (;;) {
      const l = i * 2;
      const r = l + 1;
      let m = i;
      if (l <= this.heapSize && this.f[this.heap[l]] < this.f[this.heap[m]]) m = l;
      if (r <= this.heapSize && this.f[this.heap[r]] < this.f[this.heap[m]]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }

  /**
   * A* from node to node for an aircraft of the given code letter, avoiding closed, wrong direction,
   * too narrow and too weak edges, and never crossing a runway. Writes edges and directions into the
   * output arrays and returns the number of edges, or -1 when there is no route.
   */
  route(from: number, to: number, code: CodeLetter, maxAcr: number, surfaceMask: number, outEdge: Int32Array, outDir: Int8Array, maxLen: number): number {
    if (from === to) return 0;
    const codeIdx = codeIndex(code);
    this.g.fill(Infinity);
    this.closed.fill(0);
    this.heapSize = 0;
    this.g[from] = 0;
    this.f[from] = this.heuristic(from, to);
    this.cameEdge[from] = -1;
    this.heapPush(from);
    let found = false;
    while (this.heapSize > 0) {
      const n = this.heapPop();
      if (n === to) {
        found = true;
        break;
      }
      this.closed[n] = 1;
      // A runway node can be a start or goal, never a way through.
      if (this.nodeOnRunway[n] === 1 && n !== from) continue;
      for (let p = this.adjStart[n]; p < this.adjStart[n + 1]; p++) {
        const e = this.adjEdge[p];
        const dir = this.adjDir[p];
        const kind = this.edgeKind[e];
        if (kind === EdgeKind.Runway) continue;
        if (this.edgeClosed[e] === 1) continue;
        if (this.edgeOneWay[e] === 1 && dir === -1) continue;
        if (this.edgeMaxCode[e] < codeIdx) continue;
        if (this.edgePcr[e] * 1.1 < maxAcr) continue;
        if (((surfaceMask >> this.edgeSurface[e]) & 1) === 0) continue;
        const m = dir === 1 ? this.edgeTo[e] : this.edgeFrom[e];
        if (this.closed[m] === 1) continue;
        // Stand lead ins are dead ends: only the start or goal may sit on one.
        if (kind === EdgeKind.StandLeadIn && n !== from && m !== to) continue;
        // A pass through stand with a lead out is left forward, never by push back (T72).
        if (kind === EdgeKind.StandLeadIn && dir === -1 && this.standOut[this.edgeStand[e]] === 1) continue;
        // A lead out is driven forward and only by an aircraft leaving its own stand.
        if (kind === EdgeKind.StandLeadOut && (dir === -1 || from !== this.standNode[this.edgeForkStand[e]])) continue;
        // A fork is entered only on the way to its own stand and left only from it, never driven through.
        if (kind === EdgeKind.StandFork) {
          const st = this.edgeForkStand[e];
          const fk = this.forkNode[st];
          const sn = this.standNode[st];
          if (m === fk && to !== sn && to !== fk) continue;
          if (n === fk && from !== sn && from !== fk) continue;
        }
        // Against a preferred flow the edge costs three times as much, so it is the last choice but not closed.
        const against = this.edgePreferred[e] !== 0 && this.edgePreferred[e] !== dir ? 3 : 1;
        const cost = this.g[n] + (this.edgeLen[e] / Math.max(1, this.edgeSpeed[e])) * against + this.congestion[e];
        if (cost < this.g[m]) {
          const wasIn = this.g[m] !== Infinity && this.heapPos[m] > 0 && this.heapPos[m] <= this.heapSize && this.heap[this.heapPos[m]] === m;
          this.g[m] = cost;
          this.f[m] = cost + this.heuristic(m, to);
          this.cameEdge[m] = e;
          this.cameDir[m] = dir;
          if (wasIn) this.siftUp(this.heapPos[m]);
          else this.heapPush(m);
        }
      }
    }
    if (!found) return -1;
    let count = 0;
    for (let n = to; n !== from; ) {
      const e = this.cameEdge[n];
      count++;
      n = this.cameDir[n] === 1 ? this.edgeFrom[e] : this.edgeTo[e];
    }
    if (count > maxLen) return -1;
    let k = count;
    for (let n = to; n !== from; ) {
      const e = this.cameEdge[n];
      k--;
      outEdge[k] = e;
      outDir[k] = this.cameDir[n];
      n = this.cameDir[n] === 1 ? this.edgeFrom[e] : this.edgeTo[e];
    }
    return count;
  }

  private heuristic(n: number, goal: number): number {
    return Math.hypot(this.nodeX[n] - this.nodeX[goal], this.nodeY[n] - this.nodeY[goal]) / this.maxSpeed;
  }
}
