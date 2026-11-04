export type QualityPreset = 'auto' | 'low' | 'medium' | 'high';

/** Frame time limits in ms (docs/PERFORMANCE.md section 5). */
const SLOW_MS = 20;
const FAST_MS = 12;
const WINDOW_MS = 2000;
const RESTORE_AFTER_MS = 10_000;
export const MAX_LEVEL = 3;

/**
 * Automatic quality governor. Level 0 is full quality. Level 1 lowers the people cap, level 2 drops
 * aircraft and vehicle detail one tier, level 3 backs the canvas at pixel ratio 1. The average frame
 * time over 2 s above 20 ms steps down, 10 s under 12 ms steps back up. A locked preset disables it.
 */
export class QualityGovernor {
  level = 0;
  preset: QualityPreset = 'auto';
  private sum = 0;
  private frames = 0;
  private windowStart = 0;
  private fastSince = 0;

  setPreset(p: QualityPreset): void {
    this.preset = p;
    if (p === 'low') this.level = MAX_LEVEL;
    else if (p === 'medium') this.level = 1;
    else if (p === 'high') this.level = 0;
    this.sum = 0;
    this.frames = 0;
  }

  /** Feeds one frame. Returns true when the level changed. */
  frame(ms: number, now: number): boolean {
    if (this.preset !== 'auto') return false;
    if (this.windowStart === 0) {
      this.windowStart = now;
      this.fastSince = now;
    }
    this.sum += ms;
    this.frames++;
    if (now - this.windowStart < WINDOW_MS) return false;
    const avg = this.sum / Math.max(1, this.frames);
    this.sum = 0;
    this.frames = 0;
    this.windowStart = now;
    if (avg > SLOW_MS && this.level < MAX_LEVEL) {
      this.level++;
      this.fastSince = now;
      return true;
    }
    if (avg < FAST_MS) {
      if (now - this.fastSince >= RESTORE_AFTER_MS && this.level > 0) {
        this.level--;
        this.fastSince = now;
        return true;
      }
    } else this.fastSince = now;
    return false;
  }
}
