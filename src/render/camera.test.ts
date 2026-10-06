import { describe, expect, it } from 'vitest';
import { cameraPosition, trayBounds, viewProjection } from './camera';

// Hand computation for trayBounds(4/3, 1), H = 14, insets x 1, z 0.25:
//   halfZ = 14 × 0.36397023426620234 ≈ 5.0956;  halfX = (4/3) × halfZ ≈ 6.7941
//   maxX = 6.7941 − 1 = 5.7941 → floor to 0.25 → 5.75;  minX → −5.75
//   maxZ = 5.0956 − 0.25 = 4.8456 → floor → 4.75;       minZ → −4.75
// dieScale 2 halves the raw bounds: 2.8971 → 2.75, 2.4228 → 2.25.
const HALF_Z = 14 * 0.36397023426620234;

function project(m: Float32Array, p: readonly [number, number, number]): [number, number] {
  const at = (i: number): number => m[i] ?? Number.NaN;
  const x = at(0) * p[0] + at(4) * p[1] + at(8) * p[2] + at(12);
  const y = at(1) * p[0] + at(5) * p[1] + at(9) * p[2] + at(13);
  const w = at(3) * p[0] + at(7) * p[1] + at(11) * p[2] + at(15);
  return [x / w, y / w];
}

describe('trayBounds', () => {
  it('matches the hand-computed bounds for a 4:3 canvas', () => {
    expect(trayBounds(4 / 3, 1)).toEqual({ minX: -5.75, maxX: 5.75, minZ: -4.75, maxZ: 4.75 });
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
    expect(trayBounds(4 / 3, 2)).toEqual({ minX: -2.75, maxX: 2.75, minZ: -2.25, maxZ: 2.25 });
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

  it('keeps the visible floor corners on the screen corners', () => {
    for (const aspect of [4 / 3, 2.5]) {
      const m = viewProjection(aspect, new Float32Array(16));
      const halfX = HALF_Z * aspect;
      expect(trayBounds(aspect, 1).maxX).toBeLessThanOrEqual(halfX - 1);
      for (const [x, z, sx, sy] of [
        [-halfX, -HALF_Z, -1, 1],
        [halfX, HALF_Z, 1, -1],
      ] as const) {
        const [px, py] = project(m, [x, 0, z]);
        expect(Math.abs(px - sx)).toBeLessThan(1e-4);
        expect(Math.abs(py - sy)).toBeLessThan(1e-4);
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

  it('looks straight down: a point projects to the same spot at any height', () => {
    const m = viewProjection(4 / 3, new Float32Array(16));
    expect(project(m, [0, 0, 0])).toEqual([0, 0]);
    const [lx, ly] = project(m, [0, 3, 0]);
    expect(Math.abs(lx)).toBeLessThan(1e-6);
    expect(Math.abs(ly)).toBeLessThan(1e-6);
  });

  it('places the camera 14 units above the origin', () => {
    expect(cameraPosition()).toEqual([0, 14, 0]);
  });

  it('returns a frozen camera position', () => {
    expect(Object.isFrozen(cameraPosition())).toBe(true);
  });
});
