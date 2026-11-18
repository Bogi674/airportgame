import { atan2Det } from './trig';

/**
 * Trailer kinematics for towed carts (T60). Each cart is pulled by its hitch and turns so its centre
 * stays the arm length behind the hitch on the line from where the centre was. Stepped finely, this is
 * the exact tractrix of a towed axle, so carts track inside the tractor on a turn (off tracking).
 */

export interface TowPose {
  x: number;
  y: number;
  heading: number;
}

/** Moves a towed unit behind a hitch that moved to (hx, hy), and writes its new centre and heading. */
export function followHitch(hx: number, hy: number, cx: number, cy: number, armM: number, out: TowPose): void {
  const dx = hx - cx;
  const dy = hy - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9) {
    out.x = cx;
    out.y = cy;
    return;
  }
  out.heading = atan2Det(dy, dx);
  out.x = hx - (dx / d) * armM;
  out.y = hy - (dy / d) * armM;
}

/** Steady state off tracking of one towed unit whose hitch runs on a circle of radius R: R minus its own radius. */
export function offTrackingM(radiusM: number, armM: number): number {
  return radiusM - Math.sqrt(Math.max(0, radiusM * radiusM - armM * armM));
}
