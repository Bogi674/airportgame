import { describe, expect, it } from 'vitest';
import { GROUND, GSE, GSE_INDEX } from '@data/index';
import { followHitch, offTrackingM, type TowPose } from '@shared/trailer';

const cart = GSE[GSE_INDEX.cart];
const tractor = GSE[GSE_INDEX.tractor];
/** Hitch to cart centre: the hitch gap plus half the cart. */
const ARM = GROUND.train.hitchGapM + cart.lengthM / 2;

/** Drives a train of n carts with its tractor on a circle and returns the steady radius of each cart centre. */
function circleRadii(radiusM: number, n: number): number[] {
  const step = 0.01;
  const poses: TowPose[] = [];
  for (let k = 0; k < n; k++) poses.push({ x: radiusM, y: -(k + 1) * (ARM * 2) - tractor.lengthM / 2, heading: 0 });
  let tx = radiusM;
  let ty = 0;
  let a = 0;
  for (let i = 0; i < (2 * Math.PI * radiusM * 6) / step; i++) {
    a += step / radiusM;
    const nx = radiusM * Math.cos(a);
    const ny = radiusM * Math.sin(a);
    const h = Math.atan2(ny - ty, nx - tx);
    tx = nx;
    ty = ny;
    // Hitch at the tractor tail, then each cart's own tail hitches the next.
    let hx = tx - Math.cos(h) * (tractor.lengthM / 2);
    let hy = ty - Math.sin(h) * (tractor.lengthM / 2);
    for (const p of poses) {
      followHitch(hx, hy, p.x, p.y, ARM, p);
      hx = p.x - Math.cos(p.heading) * (cart.lengthM / 2);
      hy = p.y - Math.sin(p.heading) * (cart.lengthM / 2);
    }
  }
  return poses.map((p) => Math.hypot(p.x, p.y));
}

describe('trailer kinematics', () => {
  it('matches the analytic off tracking of every cart in a train', () => {
    const R = 12;
    const radii = circleRadii(R, GROUND.cartsPerTrain.xl);
    // A hitch a half length behind a centre on radius r runs on sqrt(r^2 + half^2); the towed centre settles
    // the arm inside that, at sqrt(hitch^2 - arm^2).
    let r = R;
    let half = tractor.lengthM / 2;
    for (const got of radii) {
      const hitch = Math.sqrt(r * r + half * half);
      r = hitch - offTrackingM(hitch, ARM);
      half = cart.lengthM / 2;
      // The 1 cm steps leave a few millimetres of discretisation error.
      expect(Math.abs(got - r)).toBeLessThan(0.02);
    }
  });

  it('keeps a four cart train inside a two lane road on a 12 m turn', () => {
    const R = 12;
    const radii = circleRadii(R, GROUND.cartsPerTrain.xl);
    for (let k = 1; k < radii.length; k++) expect(radii[k]).toBeLessThan(radii[k - 1]);
    // Off tracking of the whole train stays inside the road width.
    expect(R - radii[radii.length - 1]).toBeLessThan(GROUND.road.widthM);
    expect(R - radii[radii.length - 1]).toBeGreaterThan(0.5);
  });
});
