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
export function clampInto(value: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return value < lo ? lo : value > hi ? hi : value;
}

// Margin rMax + 0.25 covers the worst jitter offset 0.15·√2.
function fitAcross(span: number, rMax: number): number {
  return Math.max(1, Math.floor((span - 2 * (rMax + 0.25)) / (2 * rMax + 0.5)) + 1);
}

/** Bodies of bounding radius `rMax` that one spawn layer holds in `bounds`. */
export function spawnCapacity(rMax: number, bounds: TrayBounds): number {
  return fitAcross(bounds.maxX - bounds.minX, rMax) * fitAcross(bounds.maxZ - bounds.minZ, rMax);
}

/**
 * Throw parameters for one wave of `count` bodies with given radii, drawn from rng in a fixed order.
 * Every draw is f = rng.float() in [0, 1); the order is part of the determinism contract:
 *
 * 1. Heading h = (hx, hz): repeat hx = 2f − 1, hz = 2f − 1 until 0.04 < hx² + hz² ≤ 1 (rejection
 *    sampling of the unit disc minus a small core), then normalize.
 * 2. Speed s = 5 + 3f.
 * 3. Per body, in index order: jitter x, jitter z, y, orientation (repeat 4 draws u = 2f − 1 until
 *    1e-6 < |u|² ≤ 1, normalized, as [x, y, z, w]: a uniform random rotation by rejection sampling
 *    of the 4-ball), speed factor, lateral, vy, ωx, ωy, ωz.
 *
 * Bodies sit in an axis-aligned block behind the tray centre, spaced 2·rMax + 0.5, filling the tray
 * width before adding a row, and stacked in layers only when the floor grid is full, so no bounding
 * spheres overlap; each x/z is clamped into the walls.
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
  const speed = 5 + 3 * rng.float();
  const px = -hz;
  const pz = hx;

  const count = radii.length;
  const rMax = Math.max(0, ...radii);
  const d = 2 * rMax + 0.5;
  const m = rMax + 0.25;
  const fitZ = fitAcross(bounds.maxZ - bounds.minZ, rMax);
  let k = 0;
  while (k * k < count) k++;
  const c = Math.min(
    fitAcross(bounds.maxX - bounds.minX, rMax),
    Math.max(k, Math.ceil(count / fitZ)),
  );
  const r = Math.min(fitZ, Math.ceil(count / c));
  const perLayer = c * r;
  const back = 0.35 * Math.min((bounds.maxX - bounds.minX) / 2, (bounds.maxZ - bounds.minZ) / 2);
  const bx = ((c - 1) / 2) * d + m;
  const bz = ((r - 1) / 2) * d + m;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const cx = clampInto(centerX - hx * back, bounds.minX + bx, bounds.maxX - bx);
  const cz = clampInto(centerZ - hz * back, bounds.minZ + bz, bounds.maxZ - bz);

  return radii.map((radius, i): ThrowState => {
    const layer = Math.floor(i / perLayer);
    const j = i - layer * perLayer;
    const col = j % c;
    const row = Math.floor(j / c);
    const x = cx + (col - (c - 1) / 2) * d + (2 * rng.float() - 1) * 0.15;
    const z = cz + (row - (r - 1) / 2) * d + (2 * rng.float() - 1) * 0.15;
    // Layer gap covers the 0.6 y jitter.
    const y = 2.2 + 0.6 * rng.float() + layer * (2 * rMax + 1.1);
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
        clampInto(x, bounds.minX + radius, bounds.maxX - radius),
        y,
        clampInto(z, bounds.minZ + radius, bounds.maxZ - radius),
      ],
      orientation: [ux / uLen, uy / uLen, uz / uLen, uw / uLen],
      velocity: [hx * along + px * lateral, vy, hz * along + pz * lateral],
      angularVelocity: [wx, wy, wz],
    };
  });
}
