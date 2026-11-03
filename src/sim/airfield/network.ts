import { codeIndex, compassVector, type AirfieldPayload, type CodeLetter, type Surface } from '@shared/airfield';
import { atan2Det } from '@shared/trig';
import { closestOnSegment, segmentIntersection, type Pt } from '@shared/geom';

export const EdgeKind = { Taxiway: 0, Taxilane: 1, RapidExit: 2, Runway: 3, StandLeadIn: 4 } as const;
export const SAMPLE_M = 2;
const MERGE_M = 3.5;
const SNAP_M = 7;
const SURFACE_INDEX: Record<Surface, number> = { dirt: 0, gravel: 1, grass: 2, asphalt: 3, concrete: 4 };
export const surfaceIndex = (s: Surface): number => SURFACE_INDEX[s];

interface Line {
  /** Source: kind of object and its id. */
  edgeKind: number;
  sourceId: number;
  pts: Pt[];
  oneWay: boolean;
  closed: boolean;
  maxCode: number;
  speedMs: number;
  pcr: number;
  surface: number;
  runwayId: number;
  /** Stand index for lead in lines, else -1. */
  standIdx: number;
}

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
  edgeClosed = new Uint8Array(0);
  edgeKind = new Uint8Array(0);
  edgePcr = new Float32Array(0);
  edgeSurface = new Uint8Array(0);
  edgeStand = new Int32Array(0);
  edgeSource = new Int32Array(0);
  /** Reservation block per edge, or -1 for one way edges. Two way taxiway edges share one block per taxiway, so opposing aircraft never meet on it. */
  edgeBlock = new Int32Array(0);
  blockTotal = 0;
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
  standEdge: Int32Array = new Int32Array(0);
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
        pts: t.points.map((p) => ({ x: p.x, y: p.y })),
        oneWay: t.oneWay,
        closed: t.closed,
        maxCode: codeIndex(t.maxCode),
        speedMs: t.speedKmh / 3.6,
        pcr: t.pcr,
        surface: surfaceIndex(t.surface),
        runwayId: -1,
        standIdx: -1,
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
        pts: [{ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y2 }],
        oneWay: false,
        closed: false,
        maxCode: 5,
        speedMs: 100,
        pcr: r.pcr,
        surface: surfaceIndex(r.surface),
        runwayId: r.id,
        standIdx: -1,
      });
    }
    // Stand lead ins run from the stand point straight back along its heading to the first pavement centerline.
    const taxiLines = lines.filter((l) => l.edgeKind !== EdgeKind.Runway);
    af.stands.forEach((s, idx) => {
      const back = compassVector((s.headingDeg + 180) % 360);
      let bestT = Infinity;
      let hit: Pt | null = null;
      for (const l of taxiLines) {
        for (let i = 1; i < l.pts.length; i++) {
          const a = l.pts[i - 1];
          const b = l.pts[i];
          const t = segmentIntersection(s.x, s.y, s.x + back.x * 260, s.y + back.y * 260, a.x, a.y, b.x, b.y);
          if (t >= 0 && t < bestT) {
            bestT = t;
            hit = { x: s.x + back.x * 260 * t, y: s.y + back.y * 260 * t };
          }
        }
      }
      if (!hit) {
        // Fall back to the nearest centerline point within reach.
        let best = 150;
        const c = { x: 0, y: 0, t: 0 };
        for (const l of taxiLines) {
          for (let i = 1; i < l.pts.length; i++) {
            closestOnSegment(s.x, s.y, l.pts[i - 1].x, l.pts[i - 1].y, l.pts[i].x, l.pts[i].y, c);
            const d = Math.hypot(s.x - c.x, s.y - c.y);
            if (d < best) {
              best = d;
              hit = { x: c.x, y: c.y };
            }
          }
        }
      }
      if (!hit) return;
      lines.push({
        edgeKind: EdgeKind.StandLeadIn,
        sourceId: s.id,
        // From the pavement to the stand, so forward is the way an arriving aircraft drives.
        pts: [hit, { x: s.x, y: s.y }],
        oneWay: false,
        closed: false,
        maxCode: codeIndex(s.code),
        speedMs: 4,
        pcr: 999,
        surface: surfaceIndex(s.surface),
        runwayId: -1,
        standIdx: idx,
      });
    });

    this.splitCrossings(lines);
    this.snapEnds(lines);
    this.assemble(lines, af);
  }

  /** Inserts shared vertices where two lines cross. */
  private splitCrossings(lines: Line[]): void {
    const inserts = new Map<string, { t: number; x: number; y: number }[]>();
    const key = (li: number, si: number): string => `${li}:${si}`;
    for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        if (lines[a].edgeKind === EdgeKind.StandLeadIn && lines[b].edgeKind === EdgeKind.StandLeadIn) continue;
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
    const seqs: number[][] = lines.map((l) => {
      const seq: number[] = [];
      for (const p of l.pts) {
        const n = nodeFor(p);
        if (seq.length === 0 || seq[seq.length - 1] !== n) seq.push(n);
      }
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
      let chain: Pt[] = [{ x: nx[seq[0]], y: ny[seq[0]] }];
      for (let k = 1; k < line.pts.length; k++) {
        const n = nodeFor(line.pts[k]);
        const prevNode = nodeFor(line.pts[k - 1]);
        if (n === prevNode) continue;
        chain.push({ x: nx[n], y: ny[n] });
        const isCut = k === line.pts.length - 1 || degree[n] !== 2;
        if (isCut) {
          raw.push({ from: nodeFor(chain[0]), to: n, pts: chain, line });
          chain = [{ x: nx[n], y: ny[n] }];
        }
      }
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
    this.edgeClosed = new Uint8Array(E);
    this.edgeKind = new Uint8Array(E);
    this.edgePcr = new Float32Array(E);
    this.edgeSurface = new Uint8Array(E);
    this.edgeStand = new Int32Array(E).fill(-1);
    this.edgeSource = new Int32Array(E);
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
      this.edgeClosed[e] = r.line.closed ? 1 : 0;
      this.edgeKind[e] = r.line.edgeKind;
      this.edgePcr[e] = r.line.pcr;
      this.edgeSurface[e] = r.line.surface;
      this.edgeStand[e] = r.line.standIdx;
      this.edgeSource[e] = r.line.sourceId;
      if (r.line.edgeKind === EdgeKind.Runway) {
        this.nodeOnRunway[r.from] = 1;
        this.nodeOnRunway[r.to] = 1;
      }
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
    const blockOfKey = new Map<number, number>();
    for (let e = 0; e < E; e++) {
      const kind = this.edgeKind[e];
      if (kind === EdgeKind.Runway || this.edgeOneWay[e] === 1) continue;
      // Taxiway edges share their taxiway's block, stand lead ins have their own.
      const key = kind === EdgeKind.StandLeadIn ? 1_000_000 + e : this.edgeSource[e];
      let b = blockOfKey.get(key);
      if (b === undefined) {
        b = blockOfKey.size;
        blockOfKey.set(key, b);
      }
      this.edgeBlock[e] = b;
    }
    this.blockTotal = blockOfKey.size;
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

    // Stand and entry nodes.
    this.standNode = new Int32Array(af.stands.length).fill(-1);
    this.standEdge = new Int32Array(af.stands.length).fill(-1);
    for (let e = 0; e < E; e++) {
      if (this.edgeStand[e] >= 0) {
        this.standNode[this.edgeStand[e]] = this.edgeTo[e];
        this.standEdge[this.edgeStand[e]] = e;
      }
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
        const holdAt = af.holding.find((h) => h.runwayId === en.runwayId && h.taxiwayId === en.taxiwayId);
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
    this.congestion = new Float64Array(E);
    this.maxSpeed = 1;
    for (let e = 0; e < E; e++) if (this.edgeKind[e] !== EdgeKind.Runway) this.maxSpeed = Math.max(this.maxSpeed, this.edgeSpeed[e]);
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
        const cost = this.g[n] + this.edgeLen[e] / Math.max(1, this.edgeSpeed[e]) + this.congestion[e];
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
