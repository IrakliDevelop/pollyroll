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

const LATE_SPEED = 0.4;
const TOSS_DRIFT = 0.3;

function fitAcross(span: number, m: number): number {
  return Math.max(1, Math.floor((span - 2 * m) / (2 * m)) + 1);
}

/** Bodies of bounding radius `rMax` that one spawn layer holds in `bounds`. */
export function spawnCapacity(rMax: number, bounds: TrayBounds): number {
  const m = rMax + 0.25;
  return fitAcross(bounds.maxX - bounds.minX, m) * fitAcross(bounds.maxZ - bounds.minZ, m);
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
 *    of the 4-ball), speed factor, lateral, vy, ωx, ωy, ωz. A body marked in `tossed` (a coin)
 *    draws, after lateral: vy = 6 + 2f upward, a horizontal spin axis (repeat ax = 2f − 1,
 *    az = 2f − 1 until 0.04 < ax² + az² ≤ 1, normalized), spin 25 + 15f about it, then ±5f about
 *    its own cap axis; its horizontal velocity is TOSS_DRIFT times a die's.
 *
 * Bodies sit in an axis-aligned block behind the tray centre, spaced 2·rMax + 0.5, filling the tray
 * width before adding a row, and stacked in layers only when the floor grid is full, so no bounding
 * spheres overlap; each x/z is clamped into the walls. A later wave (non-empty `resting`, x/z pairs
 * of bodies already in the world) centres its block on the 9×5 grid point farthest from them and
 * throws at LATE_SPEED times the speed.
 */
export function throwWave(
  rng: SeedRng,
  radii: readonly number[],
  bounds: TrayBounds,
  resting: readonly number[] = [],
  tossed: readonly boolean[] = [],
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
  // Margin covers the worst jitter offset 0.15·√2.
  const m = rMax + 0.25;
  const d = 2 * m;
  const fitZ = fitAcross(bounds.maxZ - bounds.minZ, m);
  let k = 0;
  while (k * k < count) k++;
  const c = Math.min(fitAcross(bounds.maxX - bounds.minX, m), Math.max(k, Math.ceil(count / fitZ)));
  const r = Math.min(fitZ, Math.ceil(count / c));
  const perLayer = c * r;
  const back = 0.35 * Math.min((bounds.maxX - bounds.minX) / 2, (bounds.maxZ - bounds.minZ) / 2);
  const bx = ((c - 1) / 2) * d + m;
  const bz = ((r - 1) / 2) * d + m;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  let cx = clampInto(centerX - hx * back, bounds.minX + bx, bounds.maxX - bx);
  let cz = clampInto(centerZ - hz * back, bounds.minZ + bz, bounds.maxZ - bz);
  const late = resting.length > 0 ? LATE_SPEED : 1;
  let best = -1;
  for (let gi = 0; resting.length > 0 && gi <= 8; gi++) {
    for (let gj = 0; gj <= 4; gj++) {
      const x = clampInto(
        bounds.minX + ((bounds.maxX - bounds.minX) * gi) / 8,
        bounds.minX + bx,
        bounds.maxX - bx,
      );
      const z = clampInto(
        bounds.minZ + ((bounds.maxZ - bounds.minZ) * gj) / 4,
        bounds.minZ + bz,
        bounds.maxZ - bz,
      );
      let score = Infinity;
      for (let k = 0; k + 1 < resting.length; k += 2) {
        const dx = x - (resting[k] ?? 0);
        const dz = z - (resting[k + 1] ?? 0);
        score = Math.min(score, dx * dx + dz * dz);
      }
      if (score > best) {
        best = score;
        cx = x;
        cz = z;
      }
    }
  }

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
    const along = late * speed * (0.85 + 0.3 * rng.float());
    const lateral = late * (2 * rng.float() - 1) * 1.5;
    const position: Vec3 = [
      clampInto(x, bounds.minX + radius, bounds.maxX - radius),
      y,
      clampInto(z, bounds.minZ + radius, bounds.maxZ - radius),
    ];
    const orientation: Quat = [ux / uLen, uy / uLen, uz / uLen, uw / uLen];
    const vx = hx * along + px * lateral;
    const vz = hz * along + pz * lateral;
    if (tossed[i] === true) {
      const vy = 6 + 2 * rng.float();
      let ax = 0;
      let az = 0;
      let aSq = 0;
      do {
        ax = 2 * rng.float() - 1;
        az = 2 * rng.float() - 1;
        aSq = ax * ax + az * az;
      } while (!(aSq > 0.04 && aSq <= 1));
      const spin = (25 + 15 * rng.float()) / Math.sqrt(aSq);
      const own = (2 * rng.float() - 1) * 5;
      const [qx, qy, qz, qw] = orientation;
      // Cap axis: second column of the rotation matrix of the orientation.
      const cx = 2 * (qx * qy - qz * qw);
      const cy = 1 - 2 * (qx * qx + qz * qz);
      const cz = 2 * (qy * qz + qx * qw);
      return {
        position,
        orientation,
        velocity: [TOSS_DRIFT * vx, vy, TOSS_DRIFT * vz],
        angularVelocity: [ax * spin + cx * own, cy * own, az * spin + cz * own],
      };
    }
    const vy = -2 * rng.float();
    const wx = (2 * rng.float() - 1) * 25;
    const wy = (2 * rng.float() - 1) * 25;
    const wz = (2 * rng.float() - 1) * 25;
    return { position, orientation, velocity: [vx, vy, vz], angularVelocity: [wx, wy, wz] };
  });
}
