import type { PlaceBagNode } from './ops/baggage/baggage';
import type { GridCopy, GridPatch } from './terminal/gridPatch';

/**
 * One step of the shared undo history (T85). Airfield steps only mark the order: the airfield keeps their content on
 * its own stack. Every other step carries what undo and redo need, and cash is the money the step booked (negative
 * for a purchase), so undo books its opposite and redo books it again.
 */
export type HistoryStep =
  | { k: 'airfield' }
  /** A terminal edit on a building that existed before and after it. */
  | { k: 'patch'; patch: GridPatch; cash: number }
  /** A terminal edit that made a building (before null) or removed it (after null). */
  | { k: 'whole'; before: GridCopy | null; after: GridCopy | null; cash: number }
  /** A baggage node placed (removed false) or removed (removed true); id is the node's current id. */
  | { k: 'bag'; place: PlaceBagNode; id: number; removed: boolean; cash: number };

/** What the history needs from the sim to replay a step backward or forward. */
export interface HistoryHost {
  cash(): number;
  book(amount: number): void;
  airfieldUndo(): string | null;
  airfieldRedo(): string | null;
  patchGrid(p: GridPatch, side: 'before' | 'after'): boolean;
  removeGrid(id: number): boolean;
  restoreGrid(copy: GridCopy): boolean;
  removeBag(id: number): boolean;
  /** Places a node for free and returns its new id, or -1 when the cells are no longer free. */
  placeBag(p: PlaceBagNode): number;
}

/** Most steps kept. The oldest step is forgotten first; airfield steps it held stay on the airfield stack unused. */
const MAX_STEPS = 200;

/** The shared undo and redo stacks. Not saved: a loaded game starts with an empty history, as the airfield did. */
export class History {
  private past: HistoryStep[] = [];
  private future: HistoryStep[] = [];
  /** Bumped on every change of either stack, so the UI learns when undo or redo became available. */
  version = 0;

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Records a new step, which ends the redo branch. */
  push(step: HistoryStep): void {
    this.past.push(step);
    if (this.past.length > MAX_STEPS) this.past.shift();
    this.future.length = 0;
    this.version++;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.version++;
  }

  /** Undoes the last step. Returns a problem code, or null when it was undone. */
  undo(host: HistoryHost): string | null {
    const step = this.past[this.past.length - 1];
    if (!step) return 'nothingToUndo';
    const r = this.run(host, step, true);
    if (r !== null) return r;
    this.past.pop();
    this.future.push(step);
    this.version++;
    return null;
  }

  /** Redoes the last undone step. Returns a problem code, or null when it was redone. */
  redo(host: HistoryHost): string | null {
    const step = this.future[this.future.length - 1];
    if (!step) return 'nothingToRedo';
    const r = this.run(host, step, false);
    if (r !== null) return r;
    this.future.pop();
    this.past.push(step);
    this.version++;
    return null;
  }

  private run(host: HistoryHost, step: HistoryStep, back: boolean): string | null {
    if (step.k === 'airfield') return back ? host.airfieldUndo() : host.airfieldRedo();
    // Undo books the opposite of what the step booked, redo books it again. Taking money needs the cash first.
    const money = back ? -step.cash : step.cash;
    if (money < 0 && host.cash() < -money) return `insufficientFunds|cost=${-money}`;
    let ok: boolean;
    if (step.k === 'patch') ok = host.patchGrid(step.patch, back ? 'before' : 'after');
    else if (step.k === 'whole') {
      const to = back ? step.before : step.after;
      const from = back ? step.after : step.before;
      ok = true;
      if (from) ok = host.removeGrid(from.id);
      if (ok && to) ok = host.restoreGrid(to);
    } else {
      const remove = back !== step.removed;
      if (remove) ok = host.removeBag(step.id);
      else {
        const id = host.placeBag(step.place);
        ok = id >= 0;
        if (ok) step.id = id;
      }
    }
    if (!ok) return 'historyBlocked';
    if (money !== 0) host.book(money);
    return null;
  }
}
