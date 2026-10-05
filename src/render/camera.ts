import type { TrayBounds } from '../physics/world';

export const FOV_Y_DEG = 40;
export const PITCH_DEG = 50;
export const CAMERA_DISTANCE = 14;
export const TRAY_MARGIN = 0.5;

// Literal trig values so trayBounds is bit-identical in every engine.
const SIN_50 = 0.766044443118978;
const COS_50 = 0.6427876096865394;
const SIN_20 = 0.3420201433256687;
const TAN_30 = 0.5773502691896257;
const TAN_70 = 2.7474774194546216;
const SIN_70 = 0.9396926207859083;

const HEIGHT = CAMERA_DISTANCE * SIN_50;
const OFFSET_Z = CAMERA_DISTANCE * COS_50;
const POSITION: readonly [number, number, number] = [0, HEIGHT, OFFSET_Z];

const NEAR = 1;
const FAR = 50;

/** Column-major 4×4 view-projection for the fixed camera (target origin, pitch 50°, on the +Z side looking toward −Z). */
export function viewProjection(aspect: number, out: Float32Array): Float32Array {
  const pitch = (PITCH_DEG * Math.PI) / 180;
  const s = Math.sin(pitch);
  const c = Math.cos(pitch);
  const f = 1 / Math.tan((FOV_Y_DEG * Math.PI) / 360);
  const a = (FAR + NEAR) / (NEAR - FAR);
  const b = (2 * FAR * NEAR) / (NEAR - FAR);
  const d = CAMERA_DISTANCE;
  // View rows: x, c·y − s·z, s·y + c·z − D; projection P · V written column by column.
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f * c;
  out[6] = a * s;
  out[7] = -s;
  out[8] = 0;
  out[9] = -f * s;
  out[10] = a * c;
  out[11] = -c;
  out[12] = 0;
  out[13] = 0;
  out[14] = b - a * d;
  out[15] = d;
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
  const zFar = OFFSET_Z - HEIGHT / TAN_30;
  const zNear = OFFSET_Z - HEIGHT / TAN_70;
  // The near-edge floor point sits 20° off the view axis at view depth (H / sin70)·cos20, so the
  // visible half width there is (H / sin70)·cos20·aspect·tan20 = (H / sin70)·aspect·sin20.
  const halfW = (HEIGHT / SIN_70) * aspect * SIN_20;
  // `+ 0` turns a negative-zero result into 0.
  const ceil = (v: number): number => Math.ceil((v / dieScale) * 4) / 4 + 0;
  const floor = (v: number): number => Math.floor((v / dieScale) * 4) / 4 + 0;
  return {
    minX: Math.min(ceil(-halfW + TRAY_MARGIN), -2),
    maxX: Math.max(floor(halfW - TRAY_MARGIN), 2),
    minZ: ceil(zFar + TRAY_MARGIN),
    maxZ: floor(zNear - TRAY_MARGIN),
  };
}
