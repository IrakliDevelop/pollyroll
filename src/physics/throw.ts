import type { SeedRng } from '../core/rng';
import type { Quat, Vec3 } from '../geometry/vec';
import type { TrayBounds } from './world';

export interface ThrowState {
  position: Vec3;
  orientation: Quat;
  velocity: Vec3;
  angularVelocity: Vec3;
}

/** Clamps `value` into [lo, hi]; when the interval is empty (die wider than the tray), the midpoint. */
function clampInto(value: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Throw parameters for one wave of `count` bodies with given radii, drawn from rng in a fixed order.
 * Every draw is f = rng.float() in [0, 1); the order is part of the determinism contract:
 *
 * 1. Heading h = (hx, hz): repeat hx = 2f − 1, hz = 2f − 1 until 0.04 < hx² + hz² ≤ 1 (rejection
 *    sampling of the unit disc minus a small core), then normalize.
 * 2. Speed s = 9 + 5f.
 * 3. Per body, in index order: jitter x, jitter z, y, orientation (repeat 4 draws u = 2f − 1 until
 *    1e-6 < |u|² ≤ 1, normalized, as [x, y, z, w]: a uniform random rotation by rejection sampling
 *    of the 4-ball), speed factor, lateral, vy, ωx, ωy, ωz.
 *
 * Bodies sit on a grid of `cols` columns (smallest cols with cols² ≥ count) across the heading,
 * behind the tray centre; each spawn x/z is clamped into [min + r, max − r] of the bounds.
 */
export function throwWave(
  rng: SeedRng,
  radii: readonly number[],
  bounds: TrayBounds,
): ThrowState[] {
  let hx = 0;
  let hz = 0;
  let lenSq = 0;
  do {
    hx = 2 * rng.float() - 1;
    hz = 2 * rng.float() - 1;
    lenSq = hx * hx + hz * hz;
  } while (!(lenSq > 0.04 && lenSq <= 1));
  const hLen = Math.sqrt(lenSq);
  hx /= hLen;
  hz /= hLen;
  const speed = 9 + 5 * rng.float();
  const px = -hz;
  const pz = hx;

  const count = radii.length;
  let cols = 0;
  while (cols * cols < count) cols++;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const back = 0.35 * Math.min((bounds.maxX - bounds.minX) / 2, (bounds.maxZ - bounds.minZ) / 2);

  return radii.map((r, i): ThrowState => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const across = (col - (cols - 1) / 2) * 1.3;
    const x = centerX - hx * back + px * across - hx * (row * 1.3) + (2 * rng.float() - 1) * 0.15;
    const z = centerZ - hz * back + pz * across - hz * (row * 1.3) + (2 * rng.float() - 1) * 0.15;
    const y = 2.2 + 0.6 * rng.float();
    let ux = 0;
    let uy = 0;
    let uz = 0;
    let uw = 0;
    let uSq = 0;
    do {
      ux = 2 * rng.float() - 1;
      uy = 2 * rng.float() - 1;
      uz = 2 * rng.float() - 1;
      uw = 2 * rng.float() - 1;
      uSq = ux * ux + uy * uy + uz * uz + uw * uw;
    } while (!(uSq > 1e-6 && uSq <= 1));
    const uLen = Math.sqrt(uSq);
    const along = speed * (0.85 + 0.3 * rng.float());
    const lateral = (2 * rng.float() - 1) * 1.5;
    const vy = -2 * rng.float();
    const wx = (2 * rng.float() - 1) * 25;
    const wy = (2 * rng.float() - 1) * 25;
    const wz = (2 * rng.float() - 1) * 25;
    return {
      position: [
        clampInto(x, bounds.minX + r, bounds.maxX - r),
        y,
        clampInto(z, bounds.minZ + r, bounds.maxZ - r),
      ],
      orientation: [ux / uLen, uy / uLen, uz / uLen, uw / uLen],
      velocity: [hx * along + px * lateral, vy, hz * along + pz * lateral],
      angularVelocity: [wx, wy, wz],
    };
  });
}
