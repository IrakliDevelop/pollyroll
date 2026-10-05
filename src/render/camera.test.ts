import { describe, expect, it } from 'vitest';
import { CAMERA_DISTANCE, cameraPosition, trayBounds, viewProjection } from './camera';

// Hand computation for trayBounds(4/3, 1), D = 14, margins far 2.5, near 0.75, side 0.5:
//   H = 14 × 0.766044443118978 ≈ 10.7246;  Z = 14 × 0.6427876096865394 ≈ 8.9990
//   zFar  = Z − H / 0.5773502691896257 ≈ 8.9990 − 18.5755 ≈ −9.5766
//   zNear = Z − H / 2.7474774194546216 ≈ 8.9990 − 3.9034 ≈ 5.0956
//   halfW = (H / 0.9396926207859083) × (4/3) × 0.3420201433256687 ≈ 11.4129 × 0.45603 ≈ 5.2046
//     (near-edge view depth is (H / sin70)·cos20, so the visible half width is that × aspect × tan20
//      = (H / sin70) × aspect × sin20)
//   minX = −4.7046 → ceil to 0.25 → −4.5;  maxX = 4.7046 → floor → 4.5
//   minZ = −7.0766 → ceil → −7;            maxZ = 4.3456 → floor → 4.25
// dieScale 2 halves the raw bounds: ±2.3523 → ±2.25, −3.5383 → −3.5, 2.1728 → 2.
const ZFAR = -9.576564013118725;
const ZNEAR = 5.0955832797268314;
/** Unquantized near-edge half width per unit aspect: (H / sin70) × sin20. */
const NEAR_HALF_WIDTH = ((14 * 0.766044443118978) / 0.9396926207859083) * 0.3420201433256687;

function project(m: Float32Array, p: readonly [number, number, number]): [number, number] {
  const at = (i: number): number => m[i] ?? Number.NaN;
  const x = at(0) * p[0] + at(4) * p[1] + at(8) * p[2] + at(12);
  const y = at(1) * p[0] + at(5) * p[1] + at(9) * p[2] + at(13);
  const w = at(3) * p[0] + at(7) * p[1] + at(11) * p[2] + at(15);
  return [x / w, y / w];
}

describe('trayBounds', () => {
  it('matches the hand-computed bounds for a 4:3 canvas', () => {
    expect(trayBounds(4 / 3, 1)).toEqual({ minX: -4.5, maxX: 4.5, minZ: -7, maxZ: 4.25 });
  });

  it('quantizes every bound to a multiple of 0.25', () => {
    for (const aspect of [0.5, 1, 4 / 3, 16 / 9, 2.37]) {
      for (const dieScale of [0.7, 1, 1.3, 2]) {
        const b = trayBounds(aspect, dieScale);
        for (const v of [b.minX, b.maxX, b.minZ, b.maxZ])
          expect(Number.isInteger(v * 4)).toBe(true);
        expect(b.minX).toBeLessThan(b.maxX);
        expect(b.minZ).toBeLessThan(b.maxZ);
      }
    }
  });

  it('halves the extents for dieScale 2 (before quantization)', () => {
    expect(trayBounds(4 / 3, 2)).toEqual({ minX: -2.25, maxX: 2.25, minZ: -3.5, maxZ: 2 });
  });

  it('is identical for repeated calls', () => {
    expect(trayBounds(16 / 9, 1.25)).toEqual(trayBounds(16 / 9, 1.25));
  });

  it('keeps an x half extent of at least 2 for narrow canvases', () => {
    const b = trayBounds(0.2, 1);
    expect(b.minX).toBeLessThanOrEqual(-2);
    expect(b.maxX).toBeGreaterThanOrEqual(2);
  });

  it('never returns negative zero', () => {
    const b = trayBounds(4 / 3, 100);
    for (const v of [b.minX, b.maxX, b.minZ, b.maxZ]) expect(Object.is(v, -0)).toBe(false);
  });

  it('keeps the near-edge wall corners on screen', () => {
    for (const aspect of [4 / 3, 2.5]) {
      const m = viewProjection(aspect, new Float32Array(16));
      const halfW = NEAR_HALF_WIDTH * aspect;
      expect(trayBounds(aspect, 1).maxX).toBeLessThanOrEqual(halfW - 0.5);
      for (const x of [-halfW, halfW]) {
        expect(Math.abs(project(m, [x, 0, ZNEAR])[0])).toBeLessThanOrEqual(1 + 1e-4);
      }
    }
  });

  it('keeps a radius-0.9 die resting in any tray corner fully on screen', () => {
    const r = 0.9;
    for (const aspect of [0.5, 0.75, 1, 4 / 3, 16 / 9, 2.5, 3]) {
      const m = viewProjection(aspect, new Float32Array(16));
      const at = (i: number): number => m[i] ?? Number.NaN;
      const b = trayBounds(aspect, 1);
      // A die touching a wall at either end of it also touches the adjacent wall: the corners.
      for (const x of [b.minX + r, b.maxX - r]) {
        for (const z of [b.minZ + r, b.maxZ - r]) {
          const [px, py] = project(m, [x, r, z]);
          const w = at(3) * x + at(7) * r + at(11) * z + at(15);
          const rx = (r * at(0)) / w;
          const ry = (r * at(0) * aspect) / w;
          expect(Math.abs(px) + rx).toBeLessThanOrEqual(1);
          expect(Math.abs(py) + ry).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('rejects non-finite or non-positive aspect and dieScale', () => {
    for (const bad of [0, -1, Number.NaN, Infinity, -Infinity]) {
      expect(() => trayBounds(bad, 1)).toThrow(RangeError);
      expect(() => trayBounds(1, bad)).toThrow(RangeError);
    }
  });
});

describe('viewProjection', () => {
  it('fills and returns the output matrix', () => {
    const out = new Float32Array(16);
    expect(viewProjection(4 / 3, out)).toBe(out);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('agrees with the tray constants: origin centered, far and near floor edges at y = ±1', () => {
    for (const aspect of [1, 4 / 3, 16 / 9]) {
      const m = viewProjection(aspect, new Float32Array(16));
      const [ox, oy] = project(m, [0, 0, 0]);
      expect(Math.abs(ox)).toBeLessThan(1e-4);
      expect(Math.abs(oy)).toBeLessThan(1e-4);
      expect(Math.abs(project(m, [0, 0, ZFAR])[1] - 1)).toBeLessThan(1e-4);
      expect(Math.abs(project(m, [0, 0, ZNEAR])[1] + 1)).toBeLessThan(1e-4);
    }
  });

  it('places the camera above +Z at the fixed distance', () => {
    const [x, y, z] = cameraPosition();
    expect(x).toBe(0);
    expect(y).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
    expect(Math.abs(Math.sqrt(y * y + z * z) - CAMERA_DISTANCE)).toBeLessThan(1e-9);
  });

  it('returns a frozen camera position', () => {
    expect(Object.isFrozen(cameraPosition())).toBe(true);
  });
});
