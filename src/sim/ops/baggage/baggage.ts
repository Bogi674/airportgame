import { BAGGAGE } from '@data/index';
import { FIXTURE_KEYS, FIXTURE_ZONES, type FixtureKey, type TerminalGrid } from '@shared/business';
import { bagKey, dropOutCell, nodeCells, rampCell, validateBagNode, type BagNodeSpec } from '@shared/baggageNodes';
import { cellIndex } from '@shared/terminalOps';
import { foldU32 } from '../../hash';
import type { Business } from '../../business/business';
import { BaggageNetwork, type BagNode, type BagNodeKind, type BagWarning, type Cell, type LinkMode, type RouteResult } from './network';

/** One node as the player sees it. Drops follow the grid and have no spec, the others carry the spec they were placed with. */
export interface BagNodeRec {
  id: number;
  kind: BagNodeKind;
  building: number;
  spec: BagNodeSpec | null;
  /** Anchor cell for drops, spec origin otherwise. */
  cell: [number, number];
}

export interface BaggageHost {
  getCash(): number;
  /** Books a construction cash change, negative for a cost. */
  book(amount: number): void;
  standExists(standId: number): boolean;
}

export interface PlaceBagNode {
  building: number;
  kind: 'machine' | 'bay' | 'carousel';
  cx: number;
  cy: number;
  rot: 0 | 1 | 2 | 3;
  widthCells: number;
}

export interface BaggageSave {
  nextId: number;
  nodes: BagNodeRec[];
  /** Stands served per bay id. */
  bayStands: { id: number; stands: number[] }[];
  links: { building: number; links: [number, number, LinkMode][] }[];
}

const KIND_INDEX: readonly BagNodeKind[] = ['drop', 'machine', 'bay', 'carousel'];
const keyId = (key: FixtureKey): number => FIXTURE_KEYS.indexOf(key) + 1;
const CHECK_IN_ID = keyId('checkIn');
const BAG_DROP_ID = keyId('bagDrop');

interface Anchor {
  x: number;
  y: number;
  rot: 0 | 1 | 2 | 3;
}

/**
 * The saved, hashed baggage subsystem: node records, one automatic link network per building, and the commands
 * that place and remove nodes. Drop points are not placed, they follow the check in and bag drop fixtures of the grid.
 */
export class Baggage {
  private recs: BagNodeRec[] = [];
  private nets: { building: number; net: BaggageNetwork }[] = [];
  private nextId = 1;
  /** True while this class edits the grid itself, so the grid hook does not sync again. */
  private editing = false;

  constructor(
    private readonly business: Business,
    private readonly host: BaggageHost,
  ) {}

  nodesOf(building: number): BagNodeRec[] {
    return this.recs.filter((r) => r.building === building);
  }

  warnings(): BagWarning[] {
    const out: BagWarning[] = [];
    for (const n of this.nets) out.push(...n.net.warnings());
    return out;
  }

  bayOfStand(standId: number): number | null {
    for (const n of this.nets) {
      const bay = n.net.bayOfStand(standId);
      if (bay !== null) return bay;
    }
    return null;
  }

  carouselOf(bayId: number): number | null {
    const rec = this.recs.find((r) => r.id === bayId);
    const net = rec ? this.netOf(rec.building) : null;
    return net ? net.carouselOf(bayId) : null;
  }

  routeDeparture(dropId: number, standId: number): RouteResult {
    const rec = this.recs.find((r) => r.id === dropId && r.kind === 'drop');
    const net = rec ? this.netOf(rec.building) : null;
    return net ? net.routeDeparture(dropId, standId) : { problem: 'noMachine' };
  }

  /** Places a machine, bay or carousel. Returns a problem code or null. */
  place(cmd: PlaceBagNode): string | null {
    const g = this.business.grids.find((x) => x.id === cmd.building);
    if (!g) return 'nothingThere';
    const spec: BagNodeSpec = { kind: cmd.kind, cx: cmd.cx, cy: cmd.cy, rot: cmd.rot, widthCells: cmd.widthCells };
    const problem = validateBagNode(g, spec);
    if (problem) return problem;
    const costs = BAGGAGE.costs;
    const cost = spec.kind === 'machine' ? costs.machine : spec.kind === 'carousel' ? costs.carousel : spec.widthCells * costs.bayPerCell;
    if (cost > this.host.getCash()) return `insufficientFunds|cost=${cost}`;
    this.host.book(-cost);
    const key = bagKey(spec.kind);
    const id = keyId(key);
    const cells = nodeCells(spec);
    for (const [x, y] of cells) {
      const i = cellIndex(g, x, y);
      g.fixture[i] = id;
      g.fixtureRot[i] = 0;
      if (g.zone[i] === 0) g.zone[i] = FIXTURE_ZONES[key][0];
    }
    this.refreshCells(g.id, cells);
    const rec: BagNodeRec = { id: this.nextId++, kind: spec.kind, building: g.id, spec, cell: [spec.cx, spec.cy] };
    this.recs.push(rec);
    this.ensureNet(g.id).add(this.netNode(rec, g));
    this.syncBuilding(g.id);
    return null;
  }

  /** Removes a placed node and clears its cells. Drop points cannot be removed, they follow the grid. */
  remove(id: number): string | null {
    const rec = this.recs.find((r) => r.id === id);
    if (!rec || rec.spec === null) return 'nothingThere';
    const g = this.business.grids.find((x) => x.id === rec.building);
    this.dropRec(rec);
    if (g) this.clearCells(g, rec.spec);
    this.syncBuilding(rec.building);
    return null;
  }

  /** Assigns a stand to a bay, or with bayId -1 unassigns it. A stand has at most one bay. */
  setStandBay(standId: number, bayId: number): string | null {
    if (!this.host.standExists(standId)) return 'nothingThere';
    const rec = bayId === -1 ? null : this.recs.find((r) => r.id === bayId && r.kind === 'bay');
    if (bayId !== -1 && !rec) return 'nothingThere';
    for (const n of this.nets) {
      const prev = n.net.bayOfStand(standId);
      if (prev !== null && prev !== bayId) n.net.unassignStand(prev, standId);
    }
    if (rec) {
      const net = this.netOf(rec.building);
      if (net) net.assignStand(rec.id, standId);
    }
    this.business.version++;
    return null;
  }

  fix(id: number): string | null {
    const rec = this.recs.find((r) => r.id === id);
    const net = rec ? this.netOf(rec.building) : null;
    if (!rec || !net) return 'nothingThere';
    net.fix(id);
    this.business.version++;
    return null;
  }

  /** The grid hook. Brings nodes in line with a building after any edit or its demolition. */
  onGridEdited(building: number): void {
    if (!this.editing) this.syncBuilding(building);
  }

  /**
   * Removes placed nodes whose cells no longer all hold their fixture, then syncs the drop points
   * with the check in and bag drop fixtures. A grid that is gone drops all its nodes and its network.
   */
  syncBuilding(building: number): void {
    const g = this.business.grids.find((x) => x.id === building);
    if (!g) {
      this.recs = this.recs.filter((r) => r.building !== building);
      this.nets = this.nets.filter((n) => n.building !== building);
      return;
    }
    const net = this.ensureNet(building);
    for (const rec of this.nodesOf(building)) {
      if (rec.spec === null) continue;
      const id = keyId(bagKey(rec.spec.kind));
      const intact = nodeCells(rec.spec).every(([x, y]) => g.fixture[cellIndex(g, x, y)] === id);
      if (intact) continue;
      this.dropRec(rec);
      this.clearCells(g, rec.spec);
    }
    const anchors = this.anchorsOf(g);
    for (const rec of this.nodesOf(building)) {
      if (rec.kind !== 'drop') continue;
      const a = anchors.find((x) => x.x === rec.cell[0] && x.y === rec.cell[1]);
      if (!a) {
        this.dropRec(rec);
        continue;
      }
      const node = net.nodeList().find((n) => n.id === rec.id);
      if (node && !sameCell(node.outPort, this.dropPort(g, a))) net.remove(rec.id);
    }
    for (const a of anchors) {
      let rec = this.recs.find((r) => r.kind === 'drop' && r.building === building && r.cell[0] === a.x && r.cell[1] === a.y);
      if (!rec) {
        rec = { id: this.nextId++, kind: 'drop', building, spec: null, cell: [a.x, a.y] };
        this.recs.push(rec);
      }
      if (!net.nodeList().some((n) => n.id === rec!.id)) net.add(this.netNode(rec, g));
    }
    this.business.version++;
  }

  saveState(): BaggageSave {
    return {
      nextId: this.nextId,
      nodes: this.recs.map((r) => ({ id: r.id, kind: r.kind, building: r.building, spec: r.spec ? { ...r.spec } : null, cell: [r.cell[0], r.cell[1]] })),
      bayStands: this.nets.flatMap((n) => n.net.nodeList().filter((x) => x.kind === 'bay').map((x) => ({ id: x.id, stands: x.stands.slice() }))),
      links: this.nets.map((n) => ({ building: n.building, links: n.net.linkList().map((l): [number, number, LinkMode] => [l.src, l.dst, l.mode]) })),
    };
  }

  /** Undefined means a save from before the baggage network: every grid is synced so its drop points appear. */
  loadState(raw: BaggageSave | undefined): void {
    this.recs = [];
    this.nets = [];
    this.nextId = 1;
    if (raw === undefined) {
      for (const g of this.business.grids) this.syncBuilding(g.id);
      return;
    }
    this.nextId = raw.nextId;
    const stands = new Map<number, number[]>(raw.bayStands.map((b) => [b.id, b.stands]));
    for (const n of raw.nodes) {
      const rec: BagNodeRec = { id: n.id, kind: n.kind, building: n.building, spec: n.spec ? { ...n.spec } : null, cell: [n.cell[0], n.cell[1]] };
      this.recs.push(rec);
      const g = this.business.grids.find((x) => x.id === rec.building);
      if (!g) continue;
      const node = this.netNode(rec, g);
      node.stands = (stands.get(rec.id) ?? []).slice();
      this.ensureNet(rec.building).insertRaw(node);
    }
    this.recs.sort((a, b) => a.id - b.id);
    for (const group of raw.links) {
      const net = this.netOf(group.building);
      if (net) for (const [src, dst, mode] of group.links) net.link(src, dst, mode);
    }
  }

  hash(h: number): number {
    let acc = foldU32(h, this.nextId);
    for (const r of this.recs) {
      acc = foldU32(foldU32(foldU32(foldU32(foldU32(acc, r.id), KIND_INDEX.indexOf(r.kind)), r.building), r.cell[0] + 65536), r.cell[1] + 65536);
      if (r.spec === null) acc = foldU32(acc, 0);
      else acc = foldU32(foldU32(foldU32(foldU32(foldU32(acc, 1), r.spec.cx + 65536), r.spec.cy + 65536), r.spec.rot), r.spec.widthCells);
    }
    for (const n of this.nets) {
      for (const node of n.net.nodeList()) {
        if (node.kind !== 'bay') continue;
        acc = foldU32(foldU32(acc, node.id), node.stands.length);
        for (const s of node.stands) acc = foldU32(acc, s);
      }
      for (const l of n.net.linkList()) acc = foldU32(foldU32(foldU32(acc, l.src), l.dst), l.mode === 'auto' ? 0 : 1);
    }
    return acc;
  }

  private netOf(building: number): BaggageNetwork | null {
    return this.nets.find((n) => n.building === building)?.net ?? null;
  }

  private ensureNet(building: number): BaggageNetwork {
    const found = this.netOf(building);
    if (found) return found;
    const net = new BaggageNetwork({ blocked: [], owned: null, maxLenM: BAGGAGE.maxLinkLengthM });
    const at = this.nets.findIndex((n) => n.building > building);
    this.nets.splice(at < 0 ? this.nets.length : at, 0, { building, net });
    return net;
  }

  /** Removes the record and its network node with its links (rule F). */
  private dropRec(rec: BagNodeRec): void {
    this.netOf(rec.building)?.remove(rec.id);
    this.recs = this.recs.filter((r) => r !== rec);
  }

  /** Clears the cells of a spec that still hold its fixture, then refreshes the grid derived data over them. */
  private clearCells(g: TerminalGrid, spec: BagNodeSpec): void {
    const id = keyId(bagKey(spec.kind));
    const cells = nodeCells(spec);
    for (const [x, y] of cells) {
      const i = cellIndex(g, x, y);
      if (i < 0 || g.fixture[i] !== id) continue;
      g.fixture[i] = 0;
      g.fixtureRot[i] = 0;
      g.leased[i] = 0;
    }
    this.refreshCells(g.id, cells);
  }

  private refreshCells(building: number, cells: Cell[]): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of cells) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    this.editing = true;
    try {
      this.business.refreshGrid(building, x0, y0, x1, y1);
    } finally {
      this.editing = false;
    }
  }

  /** Every drop point anchor of the grid in cell index order. A bag drop anchor holds fixtureRot code 1 to 4. */
  private anchorsOf(g: TerminalGrid): Anchor[] {
    const out: Anchor[] = [];
    for (let i = 0; i < g.fixture.length; i++) {
      const x = g.x0 + (i % g.w);
      const y = g.y0 + Math.floor(i / g.w);
      if (g.fixture[i] === CHECK_IN_ID) out.push({ x, y, rot: 0 });
      else if (g.fixture[i] === BAG_DROP_ID && g.fixtureRot[i] >= 1 && g.fixtureRot[i] <= 4) out.push({ x, y, rot: (g.fixtureRot[i] - 1) as 0 | 1 | 2 | 3 });
    }
    return out;
  }

  /** Out port of a drop: null when the cell is outside the grid, has no floor or holds a fixture. */
  private dropPort(g: TerminalGrid, a: Anchor): Cell | null {
    const [x, y] = dropOutCell(a.x, a.y, a.rot);
    const i = cellIndex(g, x, y);
    return i < 0 || g.floor[i] === 0 || g.fixture[i] !== 0 ? null : [x, y];
  }

  /** The network node of a record, with ports derived from its spec or from the grid. */
  private netNode(rec: BagNodeRec, g: TerminalGrid): BagNode {
    if (rec.spec === null) {
      const anchor = this.anchorsOf(g).find((a) => a.x === rec.cell[0] && a.y === rec.cell[1]);
      return { id: rec.id, kind: 'drop', floor: 0, inPort: null, outPort: anchor ? this.dropPort(g, anchor) : null, stands: [] };
    }
    return { id: rec.id, kind: rec.kind, floor: 0, inPort: rampCell(rec.spec, 'in'), outPort: rampCell(rec.spec, 'out'), stands: [] };
  }
}

const sameCell = (a: Cell | null, b: Cell | null): boolean => (a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1]);
