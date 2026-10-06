import type { TrayBounds } from '../physics/world';

const CAMERA_DISTANCE = 14;
// Wall insets in die units: about a die radius of gap so dice and shadows clear the screen edge.
const INSET_X = 0.6;
const INSET_Z = 0.6;
// Visible floor half height, literal so trayBounds is bit-identical in every engine.
const HALF_Z = 5.1;
// Tray floor per animated die (die units²): the smallest value with no resting overlap for 4–20 dice.
const AREA_PER_DIE = 5;
const POSITION: readonly [number, number, number] = Object.freeze<[number, number, number]>([
  0,
  CAMERA_DISTANCE,
  0,
]);

const TOP = 20;
const BOTTOM = -1;

/** Column-major 4×4 orthographic view-projection looking straight down −Y, screen-up −Z. */
export function viewProjection(aspect: number, out: Float32Array): Float32Array {
  out.fill(0);
  out[0] = 1 / (aspect * HALF_Z);
  out[6] = -2 / (TOP - BOTTOM);
  out[9] = -1 / HALF_Z;
  out[14] = (TOP + BOTTOM) / (TOP - BOTTOM);
  out[15] = 1;
  return out;
}

/** Camera world position (for specular). */
export function cameraPosition(): readonly [number, number, number] {
  return POSITION;
}

function positive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`);
  }
}

/** Deterministic physics walls at the visible floor edges, in die units (world / dieScale). */
export function trayBounds(aspect: number, dieScale: number): TrayBounds {
  positive('aspect', aspect);
  positive('dieScale', dieScale);
  const halfX = aspect * HALF_Z;
  // `+ 0` turns a negative-zero result into 0.
  const ceil = (v: number): number => Math.ceil(v * 4) / 4 + 0;
  const floor = (v: number): number => Math.floor(v * 4) / 4 + 0;
  return {
    minX: Math.min(ceil(-halfX / dieScale + INSET_X), -2),
    maxX: Math.max(floor(halfX / dieScale - INSET_X), 2),
    minZ: ceil(-HALF_Z / dieScale + INSET_Z),
    maxZ: floor(HALF_Z / dieScale - INSET_Z),
  };
}

/** Largest dieScale ≤ requested, stepping down 0.05 to a floor of 0.5, whose tray holds bodyCount
 *  dice at AREA_PER_DIE die units² each. */
export function fitScale(requested: number, bodyCount: number, aspect: number): number {
  let s = requested;
  for (let k = 1; s > 0.5; k++) {
    const b = trayBounds(aspect, s);
    if ((b.maxX - b.minX) * (b.maxZ - b.minZ) >= bodyCount * AREA_PER_DIE) break;
    s = Math.max((requested * 20 - k) / 20, 0.5);
  }
  return s;
}
