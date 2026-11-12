import { TICKS_PER_MINUTE } from '@shared/business';

/**
 * Decides when the terminal overlay feed publishes. Only while subscribed, at once after a subscribe, then once per
 * game minute. Holds no timers, so the sim tick is the only clock.
 */
export class OverlayPublisher {
  private on = false;
  private published = false;
  private lastTick = 0;

  /** Subscribes or unsubscribes. A new subscription publishes at once, a repeated call changes nothing. */
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.published = false;
  }

  /** True when a publish is due at this tick. A tick before the last publish means the sim was replaced, so it is due. */
  due(tick: number): boolean {
    if (!this.on) return false;
    return !this.published || tick < this.lastTick || tick - this.lastTick >= TICKS_PER_MINUTE;
  }

  /** Records that a publish happened at this tick. */
  mark(tick: number): void {
    this.published = true;
    this.lastTick = tick;
  }
}
