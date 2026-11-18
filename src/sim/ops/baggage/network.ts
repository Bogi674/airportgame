import { TERMINAL_CELL_M } from '@shared/business';

/** A grid cell in terminal coordinates. One cell is TERMINAL_CELL_M metres. */
export type Cell = readonly [number, number];
export type BagNodeKind = 'drop' | 'machine' | 'bay' | 'carousel';
export type LinkMode = 'auto' | 'manual';
export type LinkProblem = 'differentFloor' | 'outsideOwned' | 'crossesPavement' | 'tooLong';

/** Inclusive rectangle of cells. */
export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BagNode {
  id: number;
  kind: BagNodeKind;
  floor: number;
  /** Ramp cell where bags enter the node, null when it takes none. */
  inPort: Cell | null;
  /** Ramp cell where bags leave the node, null when it sends none. */
  outPort: Cell | null;
  /** Bays only: stand ids served. */
  stands: number[];
}

export interface BagLink {
  src: number;
  dst: number;
  mode: LinkMode;
  cells: Cell[];
  lengthM: number;
}

export type PathResult = { cells: Cell[]; lengthM: number } | { problem: LinkProblem };

export type RouteResult =
  | { route: [number, number, number] }
  | { problem: 'noMachine' | 'noBay' | 'notRouted'; bay?: number };

export type WarningCode = 'dropNoMachine' | 'machineNoBay' | 'bayNoCarousel';

export interface BagWarning {
  id: number;
  code: WarningCode;
}

export interface BaggageNetworkOptions {
  /** Cells a link may not enter: runways, taxiways and stand pavement. */
  blocked: CellRect[];
  /** Owned land in cells, or null for unlimited land. */
  owned: CellRect | null;
  maxLenM: number;
}

const CELL_M: number = TERMINAL_CELL_M;

/** The only node kind pairs a link may join: drop to machine, machine to bay, bay to carousel. */
function isAllowedLink(src: BagNodeKind, dst: BagNodeKind): boolean {
  return (src === 'drop' && dst === 'machine') || (src === 'machine' && dst === 'bay') || (src === 'bay' && dst === 'carousel');
}

/**
 * Automatic baggage link network, docs/BAGGAGE.md section 4, ported from docs/reference/sprite-prototypes/baggage_links.py.
 * Nodes are kept sorted by id and links in insertion order, so every search and tie break is deterministic.
 */
export class BaggageNetwork {
  private readonly nodes: BagNode[] = [];
  private links: BagLink[] = [];
  private readonly blocked: CellRect[];
  private readonly owned: CellRect | null;
  private readonly maxLenM: number;

  constructor(options: BaggageNetworkOptions) {
    this.blocked = [...options.blocked];
    this.owned = options.owned;
    this.maxLenM = options.maxLenM;
  }

  /** Shorter valid L variant. On a tie the variant whose first turn is closest to the source wins. */
  path(src: Cell, dst: Cell, srcFloor: number, dstFloor: number): PathResult {
    if (srcFloor !== dstFloor) return { problem: 'differentFloor' };
    let best: { cells: Cell[]; lengthM: number; turn: number } | null = null;
    // Overwritten by every failing variant, so it always holds the reason of the last one tried.
    let lastProblem: LinkProblem = 'crossesPavement';
    for (const horizontalFirst of [true, false]) {
      const cells = this.lCells(src, dst, horizontalFirst);
      const lengthM = CELL_M * (cells.length - 1);
      const bad = this.firstProblem(cells);
      if (bad) {
        lastProblem = bad;
        continue;
      }
      if (lengthM > this.maxLenM) {
        lastProblem = 'tooLong';
        continue;
      }
      const turn = horizontalFirst ? Math.abs(dst[0] - src[0]) : Math.abs(dst[1] - src[1]);
      if (best === null || lengthM < best.lengthM || (lengthM === best.lengthM && turn < best.turn)) {
        best = { cells, lengthM, turn };
      }
    }
    if (best === null) return { problem: lastProblem };
    return { cells: best.cells, lengthM: best.lengthM };
  }

  add(node: BagNode): void {
    const at = this.nodes.findIndex((n) => n.id >= node.id);
    if (at >= 0 && this.nodes[at].id === node.id) {
      this.nodes[at] = node;
    } else {
      this.nodes.splice(at < 0 ? this.nodes.length : at, 0, node);
    }
    if (node.kind === 'drop') this.ruleA(node);
    else if (node.kind === 'bay') this.ruleB(node);
    else if (node.kind === 'machine') this.ruleD(node);
  }

  /** Adds a node without running any rule, for loading a saved network. */
  insertRaw(node: BagNode): void {
    const at = this.nodes.findIndex((n) => n.id >= node.id);
    if (at >= 0 && this.nodes[at].id === node.id) {
      this.nodes[at] = node;
    } else {
      this.nodes.splice(at < 0 ? this.nodes.length : at, 0, node);
    }
  }

  /** Nodes in id order. */
  nodeList(): readonly BagNode[] {
    return this.nodes;
  }

  /** Links in insertion order. */
  linkList(): readonly BagLink[] {
    return this.links;
  }

  /** Creates a link between two nodes. Automatic rules use it with mode auto; the player uses manual. */
  link(srcId: number, dstId: number, mode: LinkMode = 'auto'): BagLink | null {
    const a = this.node(srcId);
    const b = this.node(dstId);
    if (!isAllowedLink(a.kind, b.kind)) return null;
    if (this.links.some((l) => l.src === a.id && l.dst === b.id)) return null;
    const p = this.tryPath(a, b);
    if (p === null) return null;
    const created: BagLink = { src: a.id, dst: b.id, mode, cells: p.cells, lengthM: p.lengthM };
    this.links.push(created);
    return created;
  }

  /** Rule C. Assigning a stand links every machine that has an incoming link to the bay. */
  assignStand(bayId: number, standId: number): void {
    const bay = this.node(bayId);
    if (!bay.stands.includes(standId)) bay.stands.push(standId);
    for (const m of this.nodes) {
      if (m.kind === 'machine' && this.linksTo(m.id).length > 0) this.link(m.id, bayId);
    }
  }

  /** Rule E. Unassigning the last stand removes the automatic machine links into the bay. Manual links stay. */
  unassignStand(bayId: number, standId: number): void {
    const bay = this.node(bayId);
    const at = bay.stands.indexOf(standId);
    if (at >= 0) bay.stands.splice(at, 1);
    if (bay.stands.length === 0) {
      this.links = this.links.filter((l) => !(l.dst === bayId && l.mode === 'auto' && this.node(l.src).kind === 'machine'));
    }
  }

  /** Rule F. Removes the node and its links. Nothing is refilled, affected nodes show a warning. */
  remove(id: number): void {
    this.links = this.links.filter((l) => l.src !== id && l.dst !== id);
    const at = this.nodes.findIndex((n) => n.id === id);
    if (at >= 0) this.nodes.splice(at, 1);
  }

  /** Fix automatically: runs the rule of the node's kind again. */
  fix(id: number): void {
    const n = this.node(id);
    switch (n.kind) {
      case 'drop':
        this.ruleA(n);
        break;
      case 'bay':
        this.ruleB(n);
        break;
      case 'machine':
        this.ruleD(n);
        break;
      case 'carousel':
        break;
    }
  }

  linksFrom(id: number): BagLink[] {
    return this.links.filter((l) => l.src === id);
  }

  linksTo(id: number): BagLink[] {
    return this.links.filter((l) => l.dst === id);
  }

  machineOf(dropId: number): number | null {
    const l = this.links.find((x) => x.src === dropId);
    return l ? l.dst : null;
  }

  bayOfStand(standId: number): number | null {
    const bay = this.nodes.find((n) => n.kind === 'bay' && n.stands.includes(standId));
    return bay ? bay.id : null;
  }

  carouselOf(bayId: number): number | null {
    const l = this.links.find((x) => x.src === bayId && this.findNode(x.dst)?.kind === 'carousel');
    return l ? l.dst : null;
  }

  /** Routing of a departing bag from a drop point to the bay of the flight's stand. */
  routeDeparture(dropId: number, standId: number): RouteResult {
    const m = this.machineOf(dropId);
    if (m === null) return { problem: 'noMachine' };
    const b = this.bayOfStand(standId);
    if (b === null) return { problem: 'noBay' };
    if (!this.links.some((l) => l.src === m && l.dst === b)) return { problem: 'notRouted', bay: b };
    return { route: [dropId, m, b] };
  }

  warnings(): BagWarning[] {
    const out: BagWarning[] = [];
    for (const n of this.nodes) {
      const hasOutgoing = this.linksFrom(n.id).length > 0;
      if (n.kind === 'drop' && !hasOutgoing) out.push({ id: n.id, code: 'dropNoMachine' });
      if (n.kind === 'machine' && !hasOutgoing) out.push({ id: n.id, code: 'machineNoBay' });
      if (n.kind === 'bay' && this.carouselOf(n.id) === null) out.push({ id: n.id, code: 'bayNoCarousel' });
    }
    return out;
  }

  /** Rule A. A new drop point links to the machine with the shortest valid link. */
  private ruleA(drop: BagNode): void {
    const m = this.nearest(drop, 'machine');
    if (m) this.link(drop.id, m.id);
  }

  /** Rule B. A new bay links to the carousel with the shortest valid link. */
  private ruleB(bay: BagNode): void {
    const c = this.nearest(bay, 'carousel');
    if (c) this.link(bay.id, c.id);
  }

  /** Rule D. A new machine links to every bay that serves a stand, and takes the drop points that have no machine. */
  private ruleD(machine: BagNode): void {
    for (const b of this.nodes) {
      if (b.kind === 'bay' && b.stands.length > 0) this.link(machine.id, b.id);
    }
    for (const d of this.nodes) {
      if (d.kind === 'drop' && this.linksFrom(d.id).length === 0) this.link(d.id, machine.id);
    }
  }

  /** Valid node of the kind with the shortest link from src. The lowest id wins a distance tie. */
  private nearest(src: BagNode, kind: BagNodeKind): BagNode | null {
    let best: { node: BagNode; lengthM: number } | null = null;
    for (const n of this.nodes) {
      if (n.kind !== kind) continue;
      const p = this.tryPath(src, n);
      if (p !== null && (best === null || p.lengthM < best.lengthM)) best = { node: n, lengthM: p.lengthM };
    }
    return best ? best.node : null;
  }

  private tryPath(a: BagNode, b: BagNode): { cells: Cell[]; lengthM: number } | null {
    if (a.outPort === null || b.inPort === null) return null;
    const p = this.path(a.outPort, b.inPort, a.floor, b.floor);
    return 'problem' in p ? null : p;
  }

  private lCells(src: Cell, dst: Cell, horizontalFirst: boolean): Cell[] {
    const cells: Cell[] = [src];
    let x = src[0];
    let y = src[1];
    const walkX = (): void => {
      while (x !== dst[0]) {
        x += x < dst[0] ? 1 : -1;
        cells.push([x, y]);
      }
    };
    const walkY = (): void => {
      while (y !== dst[1]) {
        y += y < dst[1] ? 1 : -1;
        cells.push([x, y]);
      }
    };
    if (horizontalFirst) {
      walkX();
      walkY();
    } else {
      walkY();
      walkX();
    }
    return cells;
  }

  private firstProblem(cells: Cell[]): LinkProblem | null {
    for (const [x, y] of cells) {
      const problem = this.cellProblem(x, y);
      if (problem !== null) return problem;
    }
    return null;
  }

  private cellProblem(x: number, y: number): LinkProblem | null {
    const o = this.owned;
    if (o !== null && !(o.x0 <= x && x <= o.x1 && o.y0 <= y && y <= o.y1)) return 'outsideOwned';
    for (const r of this.blocked) {
      if (r.x0 <= x && x <= r.x1 && r.y0 <= y && y <= r.y1) return 'crossesPavement';
    }
    return null;
  }

  private findNode(id: number): BagNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  private node(id: number): BagNode {
    const n = this.findNode(id);
    if (!n) throw new Error(`unknown baggage node ${id}`);
    return n;
  }
}
