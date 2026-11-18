import { PEOPLE, PROFILES } from '@data/index';
import { PROFILE_KEYS } from '@data/schemas/profiles';
import { PEOPLE_MODE, SnapHeader, type SnapshotViews } from '@shared/snapshot';
import { FIGURE_FRAME } from './peoplePack';

const MAX_GEN = 0x7fffffff;
const STRIDE_M = PEOPLE.motion.strideM;
const MAX_JUMP_M = PEOPLE.motion.interpMaxJumpM;

/** Walk speed in m/s per profile id, read once from the profile data. */
const WALK_SPEED = new Float32Array(PROFILE_KEYS.length);
PROFILE_KEYS.forEach((key, id) => {
  WALK_SPEED[id] = PROFILES.profiles[key].walkSpeed;
});

/**
 * Matches people samples between two snapshots by cohort id so a render frame
 * can blend from the previous position to the current one.
 */
export class PeopleMotion {
  /** Cohort id to index in the previous snapshot. Valid only where stamp equals gen. */
  private readonly slot = new Int32Array(PROFILES.capacity);
  private readonly stamp = new Int32Array(PROFILES.capacity);
  private gen = 0;
  private prev: SnapshotViews | null = null;
  private prevTick = -1;

  /** Indexes the previous snapshot, or clears it when null. Re-indexing the same tick is skipped. */
  index(prev: SnapshotViews | null): void {
    if (prev === null) {
      this.prev = null;
      this.prevTick = -1;
      return;
    }
    const tick = prev.header[SnapHeader.Tick] ?? 0;
    if (prev === this.prev && tick === this.prevTick) return;
    if (this.gen >= MAX_GEN) {
      this.stamp.fill(0);
      this.gen = 1;
    } else {
      this.gen++;
    }
    const count = Math.min(prev.header[SnapHeader.PeopleCount] ?? 0, prev.peopleId.length);
    for (let i = 0; i < count; i++) {
      const id = prev.peopleId[i] ?? -1;
      if (id < 0 || id >= this.slot.length) continue;
      this.slot[id] = i;
      this.stamp[id] = this.gen;
    }
    this.prev = prev;
    this.prevTick = tick;
  }

  /**
   * Writes the blended position of sample i into out[0] (x) and out[1] (y), in meters.
   * Falls back to the current position when the id has no match or the move is a jump.
   */
  position(curr: SnapshotViews, i: number, alpha: number, out: Float32Array): void {
    const cx = curr.peopleX[i] ?? 0;
    const cy = curr.peopleY[i] ?? 0;
    const id = curr.peopleId[i] ?? -1;
    const prev = this.prev;
    if (prev !== null && id >= 0 && id < this.slot.length && this.stamp[id] === this.gen) {
      const j = this.slot[id] ?? 0;
      const px = prev.peopleX[j] ?? cx;
      const py = prev.peopleY[j] ?? cy;
      const dx = cx - px;
      const dy = cy - py;
      if (Math.abs(dx) <= MAX_JUMP_M && Math.abs(dy) <= MAX_JUMP_M) {
        out[0] = px + dx * alpha;
        out[1] = py + dy * alpha;
        return;
      }
    }
    out[0] = cx;
    out[1] = cy;
  }

  /**
   * Gait frame for a group. Standing groups and non walking modes use FIGURE_FRAME.
   * Walking groups step with the profile speed so the cycle matches the distance covered.
   */
  walkFrame(mode: number, gameSeconds: number, profile: number, seed: number, member: number): number {
    if (mode !== PEOPLE_MODE.Walking) return FIGURE_FRAME;
    const speed = profile >= 0 && profile < WALK_SPEED.length ? (WALK_SPEED[profile] ?? 0) : 0;
    return (Math.floor((gameSeconds * speed) / STRIDE_M) + member + (seed & 3)) & 3;
  }
}
