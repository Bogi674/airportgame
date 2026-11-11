import { SNAPSHOT_PEOPLE_CAPACITY } from '@shared/snapshot';

/**
 * Picks which cohorts to draw when the figure count is over the cap. Under the cap every cohort is
 * drawn in snapshot order. Over the cap the nearest cohorts to the camera win, so the figures that
 * matter stay visible while the rest are dropped.
 */
export class PeopleSelection {
  /** Snapshot entry indices, nearest first after an over cap select. Valid up to the returned count. */
  readonly order = new Uint16Array(SNAPSHOT_PEOPLE_CAPACITY);
  private readonly dist = new Float32Array(SNAPSHOT_PEOPLE_CAPACITY);

  /** Nearest first, ties by index. Stored once so select() does not allocate a closure. */
  private readonly byDistance = (a: number, b: number): number => {
    const da = this.dist[a];
    const db = this.dist[b];
    if (da !== db) return da < db ? -1 : 1;
    return a - b;
  };

  /** Returns how many leading entries of order to draw, keeping the figure sum at or below cap. */
  select(x: Float32Array, y: Float32Array, size: Uint8Array, n: number, camX: number, camY: number, cap: number): number {
    let total = 0;
    for (let i = 0; i < n; i++) total += size[i];
    if (total <= cap) {
      for (let i = 0; i < n; i++) this.order[i] = i;
      return n;
    }
    // Entries past n sort last through an infinite distance, so the whole buffer can be sorted in place.
    for (let i = 0; i < SNAPSHOT_PEOPLE_CAPACITY; i++) {
      this.order[i] = i;
      if (i < n) {
        const dx = x[i] - camX;
        const dy = y[i] - camY;
        this.dist[i] = dx * dx + dy * dy;
      } else {
        this.dist[i] = Infinity;
      }
    }
    this.order.sort(this.byDistance);
    let figures = 0;
    let k = 0;
    for (; k < n; k++) {
      const next = figures + size[this.order[k]];
      if (next > cap) break;
      figures = next;
    }
    return k;
  }
}
