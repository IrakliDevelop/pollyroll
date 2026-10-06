import type { TrayBounds } from '../physics/world';

const CAMERA_DISTANCE = 14;
/**
 * Wall insets from the visible floor edges, die units: the smallest (in 0.25 steps) that keep a
 * resting die in any tray corner on screen for aspects 0.5–3 and dieScale 0.7–2, since its top projects outward.
 */
const INSET_X = 1;
const INSET_Z = 0.5;

// tan of half the 40° vertical FOV, literal so trayBounds is bit-identical in every engine.
const TAN_20 = 0.36397023426620234;
const HALF_Z = CAMERA_DISTANCE * TAN_20;
const POSITION: readonly [number, number, number] = Object.freeze<[number, number, number]>([
  0,
  CAMERA_DISTANCE,
  0,
]);

const NEAR = 1;
const FAR = 50;

/** Column-major 4×4 view-projection for the fixed camera above the origin looking down −Y, screen-up −Z. */
export function viewProjection(aspect: number, out: Float32Array): Float32Array {
  const f = 1 / TAN_20;
  const a = (FAR + NEAR) / (NEAR - FAR);
  const b = (2 * FAR * NEAR) / (NEAR - FAR);
  const h = CAMERA_DISTANCE;
  // View: (x, −z, y − H); projection P · V written column by column.
  out.fill(0);
  out[0] = f / aspect;
  out[6] = a;
  out[7] = -1;
  out[9] = -f;
  out[14] = b - a * h;
  out[15] = h;
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

/** Deterministic physics walls for a canvas aspect, in die units (world / dieScale). */
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
