import { FIXTURE_KEYS, ZONE, type TerminalGrid } from '@shared/business';
import { cellIndex, cornerWorld } from '@shared/terminalOps';

const MAX_PEOPLE = 3000;
/** Each dot stands for this many passengers. */
const PAX_PER_DOT = 6;
const WALK_MPS = 1.4;
const COLORS = ['#e8c07d', '#6aa5d9', '#d9786a', '#7dc98e', '#c9a0dc', '#f2f2f2'];

const CHECK_IN = FIXTURE_KEYS.indexOf('checkIn') + 1;
const SECURITY = FIXTURE_KEYS.indexOf('security') + 1;
const BELT = FIXTURE_KEYS.indexOf('belt') + 1;
const SEATING = FIXTURE_KEYS.indexOf('seating') + 1;
const SHOP_FIRST = FIXTURE_KEYS.indexOf('convenience') + 1;
const SHOP_LAST = FIXTURE_KEYS.indexOf('pharmacy') + 1;

interface Anchors {
  entrance: number[];
  checkIn: number[];
  security: number[];
  belt: number[];
  seating: number[];
  shop: number[];
}

/**
 * Passengers as a render sample (hard rule 6). The sim only knows counts, so dots are spawned from
 * the passengers handled and walk between the fixtures the player laid: in through the public zone,
 * check in, security, a shop or a seat, and for arrivals the belt and out. They do not change the
 * simulation and a straight line between anchors is enough at this scale.
 */
export class People {
  private readonly x = new Float32Array(MAX_PEOPLE);
  private readonly y = new Float32Array(MAX_PEOPLE);
  private readonly tx = new Float32Array(MAX_PEOPLE);
  private readonly ty = new Float32Array(MAX_PEOPLE);
  private readonly dwell = new Float32Array(MAX_PEOPLE);
  private readonly stage = new Uint8Array(MAX_PEOPLE);
  private readonly arriving = new Uint8Array(MAX_PEOPLE);
  private readonly grid = new Uint8Array(MAX_PEOPLE);
  private readonly color = new Uint8Array(MAX_PEOPLE);
  private count = 0;
  private cap = MAX_PEOPLE;
  private anchors: Anchors[] = [];
  private lastPax = -1;
  private pending = 0;
  private seed = 0x9e3779b9;

  setCap(cap: number): void {
    this.cap = Math.min(MAX_PEOPLE, cap);
    if (this.count > this.cap) this.count = this.cap;
  }

  get size(): number {
    return this.count;
  }

  private rnd(): number {
    // xorshift32, render only.
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  setTerminals(grids: readonly TerminalGrid[]): void {
    this.anchors = grids.slice(0, 255).map((g) => {
      const a: Anchors = { entrance: [], checkIn: [], security: [], belt: [], seating: [], shop: [] };
      for (let cy = g.y0; cy < g.y0 + g.h; cy++) {
        for (let cx = g.x0; cx < g.x0 + g.w; cx++) {
          const i = cellIndex(g, cx, cy);
          if (g.floor[i] === 0) continue;
          const f = g.fixture[i];
          let list: number[] | null = null;
          if (f === CHECK_IN) list = a.checkIn;
          else if (f === SECURITY) list = a.security;
          else if (f === BELT) list = a.belt;
          else if (f === SEATING) list = a.seating;
          else if (f >= SHOP_FIRST && f <= SHOP_LAST) list = a.shop;
          else if (f === 0 && (g.zone[i] === ZONE.Public || g.zone[i] === ZONE.None) && (((cx % 4) + 4) % 4 === 0) && (((cy % 4) + 4) % 4 === 0)) list = a.entrance;
          if (list) {
            const w = cornerWorld(g, cx + 0.5, cy + 0.5);
            list.push(w.x, w.y);
          }
        }
      }
      return a;
    });
    this.count = 0;
  }

  /** Feeds the passengers handled today. Rising counts spawn dots. */
  setPassengers(paxToday: number): void {
    if (this.lastPax < 0 || paxToday < this.lastPax) this.lastPax = paxToday;
    this.pending += (paxToday - this.lastPax) / PAX_PER_DOT;
    this.lastPax = paxToday;
    if (this.pending > 400) this.pending = 400;
  }

  private pick(list: number[]): number {
    return Math.floor(this.rnd() * (list.length / 2)) * 2;
  }

  private spawn(): void {
    if (this.count >= this.cap || this.anchors.length === 0) return;
    const gi = Math.floor(this.rnd() * this.anchors.length);
    const a = this.anchors[gi];
    const arriving = this.rnd() < 0.4 ? 1 : 0;
    const start = arriving ? a.seating : a.entrance;
    const first = arriving ? a.belt : a.checkIn;
    if (start.length === 0 || first.length === 0) return;
    const n = this.count++;
    const s = this.pick(start);
    this.x[n] = start[s] + (this.rnd() - 0.5) * 2;
    this.y[n] = start[s + 1] + (this.rnd() - 0.5) * 2;
    const t = this.pick(first);
    this.tx[n] = first[t];
    this.ty[n] = first[t + 1];
    this.stage[n] = 0;
    this.arriving[n] = arriving;
    this.grid[n] = gi;
    this.dwell[n] = 0;
    this.color[n] = Math.floor(this.rnd() * COLORS.length);
  }

  /** Moves a dot to its next stop. Returns false when its trip is over. */
  private next(n: number): boolean {
    const a = this.anchors[this.grid[n]];
    if (!a) return false;
    const st = this.stage[n]++;
    let list: number[];
    if (this.arriving[n] === 1) {
      if (st === 0) {
        this.dwell[n] = 2 + this.rnd() * 3;
        list = a.belt;
      } else if (st === 1) list = a.entrance;
      else return false;
    } else if (st === 0) {
      this.dwell[n] = 3 + this.rnd() * 6;
      list = a.security;
    } else if (st === 1) {
      this.dwell[n] = 2 + this.rnd() * 3;
      list = a.shop.length > 0 && this.rnd() < 0.5 ? a.shop : a.seating;
    } else if (st === 2) {
      this.dwell[n] = 8 + this.rnd() * 14;
      list = a.seating;
    } else return false;
    if (list.length === 0) return false;
    const k = this.pick(list);
    this.tx[n] = list[k];
    this.ty[n] = list[k + 1];
    return true;
  }

  private remove(n: number): void {
    const last = --this.count;
    if (n === last) return;
    this.x[n] = this.x[last];
    this.y[n] = this.y[last];
    this.tx[n] = this.tx[last];
    this.ty[n] = this.ty[last];
    this.dwell[n] = this.dwell[last];
    this.stage[n] = this.stage[last];
    this.arriving[n] = this.arriving[last];
    this.grid[n] = this.grid[last];
    this.color[n] = this.color[last];
  }

  /** Advances by real seconds, scaled by the game speed. */
  // hot
  update(dtSec: number, speed: number): void {
    if (speed <= 0) return;
    const dt = dtSec * Math.min(speed, 4);
    let spawn = Math.min(this.pending, 8);
    this.pending -= spawn;
    while (spawn >= 1) {
      this.spawn();
      spawn--;
    }
    const step = WALK_MPS * dt;
    for (let n = this.count - 1; n >= 0; n--) {
      const dx = this.tx[n] - this.x[n];
      const dy = this.ty[n] - this.y[n];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > step) {
        this.x[n] += (dx / d) * step;
        this.y[n] += (dy / d) * step;
        continue;
      }
      if (this.dwell[n] > 0) {
        this.dwell[n] -= dt;
        continue;
      }
      if (!this.next(n)) this.remove(n);
    }
  }

  /** Draws the dots in world space. The caller has set the world transform. */
  // hot
  draw(ctx: CanvasRenderingContext2D, minX: number, minY: number, maxX: number, maxY: number): void {
    for (let c = 0; c < COLORS.length; c++) {
      ctx.fillStyle = COLORS[c];
      for (let n = 0; n < this.count; n++) {
        if (this.color[n] !== c) continue;
        const x = this.x[n];
        const y = this.y[n];
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        ctx.fillRect(x - 0.4, y - 0.4, 0.8, 0.8);
      }
    }
  }
}
