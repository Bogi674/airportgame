import { STAFF } from '@data/index';
import { TERMINAL_CELL_M, ZONE, type TerminalGrid } from '@shared/business';
import { cellIndex } from '@shared/terminalOps';
import { labelRooms } from '@shared/terminalRooms';
import type { Business } from '../business/business';
import { Stage } from '../cohorts/cohorts';
import type { OverlayPeople } from '../terminal/overlays';
import { foldInts, foldU32 } from '../hash';
import { packTyped, unpackTyped } from '../save/pack';

const CELL_M2 = TERMINAL_CELL_M * TERMINAL_CELL_M;
const CLEAN = STAFF.cleaning;

/** The rooms of one terminal floor and the dirt each holds (T81). Everything but dirt is derived from the grid. */
export interface GridRooms {
  id: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Room of each array cell (labelRooms), -1 off the floor. */
  label: Int32Array;
  count: number;
  /** Floor cells of each room. */
  area: Int32Array;
  /** 1 when a room has a cell off the staff zone, so passengers can use it and its cleanliness counts. */
  pax: Uint8Array;
  /** Array cell a cleaner walks to in each room: the walkable cell nearest its centre, -1 for none. */
  target: Int32Array;
  /** Dirt units at which each room is fully dirty. */
  full: Int32Array;
  /** Dirt units of each room. Saved. */
  dirt: Int32Array;
}

/** Saved form: the dirt of every room per grid id, in grid order. */
export interface CleaningSave {
  grids: { id: number; dirt: string }[];
}

/** Rooms of a grid with their area, passenger flag, cleaner target and full dirt, with no dirt yet. */
function roomsOf(g: TerminalGrid, cellNode: Int32Array | undefined): GridRooms {
  const label = labelRooms(g);
  let count = 0;
  for (let i = 0; i < label.length; i++) if (label[i]! + 1 > count) count = label[i]! + 1;
  const area = new Int32Array(count);
  const pax = new Uint8Array(count);
  const sx = new Float64Array(count);
  const sy = new Float64Array(count);
  for (let i = 0; i < label.length; i++) {
    const r = label[i]!;
    if (r < 0) continue;
    area[r]++;
    sx[r] += i % g.w;
    sy[r] += Math.floor(i / g.w);
    if (g.zone[i] !== ZONE.Staff) pax[r] = 1;
  }
  const target = new Int32Array(count).fill(-1);
  const best = new Float64Array(count).fill(Infinity);
  for (let i = 0; i < label.length; i++) {
    const r = label[i]!;
    if (r < 0 || !cellNode || cellNode[i]! < 0) continue;
    const dx = (i % g.w) - sx[r]! / area[r]!;
    const dy = Math.floor(i / g.w) - sy[r]! / area[r]!;
    const d = dx * dx + dy * dy;
    if (d < best[r]!) {
      best[r] = d;
      target[r] = i;
    }
  }
  const full = new Int32Array(count);
  for (let r = 0; r < count; r++) full[r] = Math.max(1, Math.round(area[r]! * CELL_M2 * CLEAN.dirtyPerM2));
  return { id: g.id, x0: g.x0, y0: g.y0, w: g.w, h: g.h, label, count, area, pax, target, full, dirt: new Int32Array(count) };
}

/**
 * Terminal dirt per room (T81): passengers make the rooms they are in dirty once a game minute, cleaners sent by the
 * staff clean them, and the area weighted cleanliness of the passenger rooms joins the rating. Rooms are rebuilt when
 * the floors change, carrying each new room the most dirt of the old rooms it overlaps.
 */
export class Cleaning {
  /** Rooms per grid index. */
  rooms: GridRooms[] = [];
  /** Area weighted share of clean floor over the passenger rooms, 1 with none. Updated with the dirt. */
  cleanliness = 1;
  /** Dirt from a save, applied by grid id at the next rebuild. */
  private pending = new Map<number, Int32Array>();
  private builtFor = -1;
  private builtGrids = -1;
  private builtWalk = -1;

  constructor(
    private readonly business: Business,
    private readonly people: OverlayPeople,
  ) {}

  /** Rebuilds the rooms when the floors or walk graphs changed. Returns true when they were rebuilt. */
  refresh(): boolean {
    const b = this.business;
    if (this.builtFor === b.terminalVersion && this.builtGrids === b.grids.length && this.builtWalk === b.walkVersion) return false;
    this.builtFor = b.terminalVersion;
    this.builtGrids = b.grids.length;
    this.builtWalk = b.walkVersion;
    const old = new Map<number, GridRooms>();
    for (const r of this.rooms) old.set(r.id, r);
    this.rooms = b.grids.map((g, gi) => {
      const next = roomsOf(g, b.walkGraphs[gi]?.cellNode);
      const saved = this.pending.get(g.id);
      const prev = old.get(g.id);
      if (saved && saved.length === next.count) next.dirt.set(saved);
      else if (prev) carryDirt(prev, next);
      for (let r = 0; r < next.count; r++) next.dirt[r] = Math.min(next.dirt[r]!, next.full[r]!);
      return next;
    });
    this.pending.clear();
    return true;
  }

  /** Every CLEAN.everyMin game minutes: every passenger inside a room adds that many minutes of dirt, then the cleanliness is measured. */
  accumulate(): void {
    const add = CLEAN.dirtPerPersonMin * CLEAN.everyMin;
    const p = this.people;
    const b = this.business;
    for (let c = 0; c < p.hi; c++) {
      const st = p.stage[c]!;
      if (st === Stage.Free || st === Stage.Curb || st === Stage.Boarded || st === Stage.Missed) continue;
      const gi = p.building[c]!;
      const rooms = this.rooms[gi];
      const g = b.grids[gi];
      const sn = b.serviceNodes[gi];
      if (!rooms || !g || !sn) continue;
      const node = p.node[c]!;
      let cell = -1;
      if (node >= 0 && node < sn.count) cell = cellIndex(g, sn.lx[node]!, sn.ly[node]!);
      else if (p.walkStart[c]! >= 0) cell = cellIndex(g, p.walkToX[c]!, p.walkToY[c]!);
      const r = cell >= 0 ? rooms.label[cell]! : -1;
      if (r < 0) continue;
      rooms.dirt[r] = Math.min(rooms.full[r]!, rooms.dirt[r]! + p.size[c]! * add);
    }
    let clean = 0;
    let area = 0;
    for (const rooms of this.rooms) {
      for (let r = 0; r < rooms.count; r++) {
        if (rooms.pax[r] === 0) continue;
        clean += rooms.area[r]! * (1 - rooms.dirt[r]! / rooms.full[r]!);
        area += rooms.area[r]!;
      }
    }
    this.cleanliness = area > 0 ? clean / area : 1;
  }

  /** Room of a logical cell of a grid, -1 for none. */
  roomAt(gi: number, lx: number, ly: number): number {
    const rooms = this.rooms[gi];
    if (!rooms) return -1;
    const ax = lx - rooms.x0;
    const ay = ly - rooms.y0;
    if (ax < 0 || ay < 0 || ax >= rooms.w || ay >= rooms.h) return -1;
    return rooms.label[ay * rooms.w + ax]!;
  }

  /** True when a room is dirty enough to call a cleaner. */
  needsCleaner(gi: number, r: number): boolean {
    const rooms = this.rooms[gi];
    return !!rooms && rooms.pax[r] === 1 && rooms.target[r]! >= 0 && rooms.dirt[r]! >= CLEAN.callShare * rooms.full[r]!;
  }

  /** Game minutes a cleaner works in a room once there. */
  cleanMinutes(gi: number, r: number): number {
    const rooms = this.rooms[gi];
    const m2 = rooms ? rooms.area[r]! * CELL_M2 : 0;
    return CLEAN.cleanBaseMin + (CLEAN.cleanMinPer100M2 * m2) / 100;
  }

  /** A cleaner finished a room: its dirt is gone. */
  clean(gi: number, r: number): void {
    const rooms = this.rooms[gi];
    if (rooms && r >= 0 && r < rooms.count) rooms.dirt[r] = 0;
  }

  saveState(): CleaningSave {
    return { grids: this.rooms.map((r) => ({ id: r.id, dirt: packTyped(r.dirt) })) };
  }

  /** Restores the dirt of a save, applied by grid id when the rooms are next built. `undefined` (an older save) loads clean. */
  loadState(s: CleaningSave | undefined): void {
    this.rooms = [];
    this.pending.clear();
    this.builtFor = -1;
    this.cleanliness = 1;
    for (const g of s?.grids ?? []) this.pending.set(g.id, unpackTyped(g.dirt, Int32Array));
  }

  hash(h: number): number {
    let acc = foldU32(h, this.rooms.length);
    for (const r of this.rooms) acc = foldInts(acc, r.dirt, r.count);
    return acc;
  }
}

/** Gives each room of `next` the most dirt of the rooms of `prev` it shares a logical cell with. */
function carryDirt(prev: GridRooms, next: GridRooms): void {
  for (let i = 0; i < next.label.length; i++) {
    const r = next.label[i]!;
    if (r < 0) continue;
    const ax = next.x0 + (i % next.w) - prev.x0;
    const ay = next.y0 + Math.floor(i / next.w) - prev.y0;
    if (ax < 0 || ay < 0 || ax >= prev.w || ay >= prev.h) continue;
    const o = prev.label[ay * prev.w + ax]!;
    if (o >= 0 && prev.dirt[o]! > next.dirt[r]!) next.dirt[r] = prev.dirt[o]!;
  }
}
