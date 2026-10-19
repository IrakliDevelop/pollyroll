import { describe, expect, it } from 'vitest';
import type { RollEvent } from '../core/types';
import { shapeOf } from '../geometry/labels';
import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { penetration } from '../physics/penetration';
import { planRoll } from '../physics/plan';
import { simulate } from '../physics/sim';
import { cameraPosition, fitScale, trayBounds, viewProjection } from './camera';

// Hand computation for trayBounds(4/3, 1), orthographic half height 5.1, insets 0.6 die units:
//   halfX = (4/3) × 5.1 = 6.8;  6.8 − 0.6 = 6.2 → floor to 0.25 → 6;  minX → −6
//   halfZ = 5.1;                5.1 − 0.6 = 4.5 → floor → 4.5;         minZ → −4.5
// dieScale 2 halves the extents before the insets: 3.4 − 0.6 → 2.75, 2.55 − 0.6 → 1.75.
const HALF_Z = 5.1;

function project(m: Float32Array, p: readonly [number, number, number]): [number, number] {
  const at = (i: number): number => m[i] ?? Number.NaN;
  const x = at(0) * p[0] + at(4) * p[1] + at(8) * p[2] + at(12);
  const y = at(1) * p[0] + at(5) * p[1] + at(9) * p[2] + at(13);
  const w = at(3) * p[0] + at(7) * p[1] + at(11) * p[2] + at(15);
  return [x / w, y / w];
}

describe('trayBounds', () => {
  it('matches the hand-computed bounds for a 4:3 canvas', () => {
    expect(trayBounds(4 / 3, 1)).toEqual({ minX: -6, maxX: 6, minZ: -4.5, maxZ: 4.5 });
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

  it('halves the extents for dieScale 2 before applying the die-unit insets', () => {
    expect(trayBounds(4 / 3, 2)).toEqual({ minX: -2.75, maxX: 2.75, minZ: -1.75, maxZ: 1.75 });
  });

  it('is identical for repeated calls', () => {
    expect(trayBounds(16 / 9, 1.25)).toEqual(trayBounds(16 / 9, 1.25));
  });

  it('keeps an x half extent of at least 2 for narrow canvases', () => {
    const b = trayBounds(0.2, 1);
    expect(b.minX).toBeLessThanOrEqual(-2);
    expect(b.maxX).toBeGreaterThanOrEqual(2);
  });

  it('falls back to exactly ±2 on x when the inset tray would be narrower', () => {
    for (const [aspect, s] of [
      [0.5, 1.3],
      [0.5, 2],
      [0.75, 2],
    ] as const) {
      const b = trayBounds(aspect, s);
      expect([b.minX, b.maxX]).toEqual([-2, 2]);
    }
  });

  it('never returns negative zero', () => {
    const b = trayBounds(4 / 3, 100);
    for (const v of [b.minX, b.maxX, b.minZ, b.maxZ]) expect(Object.is(v, -0)).toBe(false);
  });

  it('keeps the visible floor corners on the screen corners', () => {
    for (const aspect of [4 / 3, 2.5]) {
      const m = viewProjection(aspect, new Float32Array(16));
      const halfX = HALF_Z * aspect;
      expect(trayBounds(aspect, 1).maxX).toBeLessThanOrEqual(halfX);
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

  it('keeps a radius-0.9 die resting in any tray corner fully on screen at any dieScale', () => {
    for (const aspect of [0.5, 0.75, 1, 4 / 3, 16 / 9, 2.5, 3]) {
      const m = viewProjection(aspect, new Float32Array(16));
      const at = (i: number): number => m[i] ?? Number.NaN;
      for (const s of [0.7, 1, 1.3, 2]) {
        const r = 0.9 * s;
        const b = trayBounds(aspect, s);
        // A ±2 tray wider than the screen cannot fit a corner die; that case is pinned separately.
        if (2 * s > HALF_Z * aspect) continue;
        // A die touching a wall at either end of it also touches the adjacent wall: the corners.
        for (const x of [b.minX * s + r, b.maxX * s - r]) {
          for (const z of [b.minZ * s + r, b.maxZ * s - r]) {
            const [px, py] = project(m, [x, r, z]);
            const w = at(3) * x + at(7) * r + at(11) * z + at(15);
            const rx = (r * at(0)) / w;
            const ry = (r * at(0) * aspect) / w;
            expect(Math.abs(px) + rx).toBeLessThanOrEqual(1);
            expect(Math.abs(py) + ry).toBeLessThanOrEqual(1);
          }
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

describe('fitScale', () => {
  // Hand computation at 4:3 with 5 die units² per die (areas from trayBounds as above):
  //   s 2    → 5.5 × 3.5 = 19.25 ≥ 1·5
  //   s 1.45 → 8 × 5.5 = 44 < 9·5;   s 1.4  → 8.5 × 6 = 51 ≥ 45
  //   s 0.9  → 13.5 × 10 = 135 < 30·5; s 0.85 → 14.5 × 10.5 = 152.25 ≥ 150
  // Radius 0.5 spawns on a 1.5 grid with margin 0.75, so capacity does not bind:
  //   s 1.4  → fitX ⌊(8.5 − 1.5) / 1.5⌋ + 1 = 5, fitZ ⌊(6 − 1.5) / 1.5⌋ + 1 = 4: 20 ≥ 9
  //   s 0.85 → fitX ⌊(14.5 − 1.5) / 1.5⌋ + 1 = 9, fitZ ⌊(10.5 − 1.5) / 1.5⌋ + 1 = 7: 63 ≥ 30
  it.each([
    [1, 2],
    [9, 1.4],
    [30, 0.85],
    [1000, 0.5],
  ])('fits %i dice at 4:3 with requested 2 to scale %s', (count, scale) => {
    expect(fitScale(2, Array<number>(count).fill(0.5), 4 / 3)).toBe(scale);
  });

  // d6 radius √3/2: spawn spacing 2.232, margin 1.116. At 608:360, halfX = 8.6133:
  //   s 1.8  → ±4 × ±2,       fitX ⌊(8 − 2.232) / 2.232⌋ + 1 = 3,   fitZ ⌊(4 − 2.232) / 2.232⌋ + 1 = 1: 3 < 4
  //   s 1.75 → ±4.25 × ±2.25, fitX ⌊(8.5 − 2.232) / 2.232⌋ + 1 = 3, fitZ ⌊(4.5 − 2.232) / 2.232⌋ + 1 = 2: 6 ≥ 4,
  //            area 8.5 × 4.5 = 38.25 ≥ 20
  //   s 2    → ±3.5 × ±1.75,  fitX ⌊(7 − 2.232) / 2.232⌋ + 1 = 3,   fitZ 1: 3 ≥ 3, area 24.5 ≥ 15
  it('shrinks 4 d6 at 608:360 until they spawn in one layer', () => {
    expect(fitScale(2, Array<number>(4).fill(Math.sqrt(3) / 2), 608 / 360)).toBe(1.75);
  });

  it('keeps 3 d6 at 608:360 at the requested scale 2: one row holds them', () => {
    expect(fitScale(2, Array<number>(3).fill(Math.sqrt(3) / 2), 608 / 360)).toBe(2);
  });

  it('keeps a requested scale below the 0.5 floor', () => {
    expect(fitScale(0.4, Array<number>(30).fill(0.5), 4 / 3)).toBe(0.4);
  });

  it('never exceeds the request, stays on the 0.05 grid, and never grows with more dice', () => {
    for (const [aspect, radius] of [
      [4 / 3, Math.sqrt(3) / 2],
      [16 / 9, 0.95],
      [0.75, 0.5],
    ] as const) {
      let prev = Infinity;
      for (let n = 1; n <= 30; n++) {
        const s = fitScale(2, Array<number>(n).fill(radius), aspect);
        expect(s).toBeLessThanOrEqual(2);
        expect(s).toBeGreaterThanOrEqual(0.5);
        expect(Number.isInteger(Math.round(s * 1e9) / 5e7)).toBe(true);
        expect(s).toBeLessThanOrEqual(prev);
        prev = s;
      }
    }
  });

  it('leaves 9 mixed dice at 4:3 resting without overlap at the fitted scale (seeds 0–49)', () => {
    const types = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;
    for (let i = 0; i < 50; i++) {
      const dice = Array.from({ length: 9 }, (_, k) => types[(i + k) % 6] ?? 'd6');
      const event: RollEvent = {
        v: 1,
        id: 'fit',
        notation: '9 mixed',
        dice: dice.map((type) => ({ type, value: 1, group: 0, wave: 0 })),
        modifier: 0,
        seed: i.toString(16).padStart(32, '0'),
        createdAt: 0,
      };
      const radii = dice.map((type) => getPolyhedron(shapeOf(type)).radius);
      const bounds = trayBounds(4 / 3, fitScale(2, radii, 4 / 3));
      const rest = planRoll(event, bounds).bodies.map((b) => ({
        shape: b.shape,
        pose: b.frames.subarray(b.frames.length - 7),
      }));
      rest.forEach((a, j) => {
        for (const b of rest.slice(j + 1)) {
          const depth = penetration(a.shape, a.pose, b.shape, b.pose);
          expect(depth, `seed ${i}`).toBeLessThanOrEqual(0.005);
        }
      });
    }
  }, 60_000);

  it('settles fitted 608:360 rolls with no die resting on another', () => {
    const run = (n: number, shape: ShapeType): ShapeType[] => Array<ShapeType>(n).fill(shape);
    const rolls: [string, ShapeType[], number[]][] = [
      ['4 d6', run(4, 'd6'), [0, 0, 0, 0]],
      ['6 d6', run(6, 'd6'), [0, 0, 0, 0, 0, 0]],
      ['4 d6 + wave-1 d6', run(5, 'd6'), [0, 0, 0, 0, 1]],
      [
        '10 mixed',
        ['d4', 'd6', 'd6', 'd8', 'd8', 'd10', 'd10', 'd12', 'd20', 'd20'],
        Array<number>(10).fill(0),
      ],
      [
        '20 mixed',
        [
          ...run(4, 'd4'),
          ...run(4, 'd6'),
          ...run(4, 'd8'),
          ...run(3, 'd10'),
          ...run(2, 'd12'),
          ...run(3, 'd20'),
        ],
        Array<number>(20).fill(0),
      ],
    ];
    for (const [name, shapes, waves] of rolls) {
      const radii = shapes.map((s) => getPolyhedron(s).radius);
      const bounds = trayBounds(608 / 360, fitScale(2, radii, 608 / 360));
      for (let i = 0; i < 150; i++) {
        const seed = i.toString(16).padStart(32, '0');
        expect(simulate({ seed, shapes, waves, bounds }).stacked, `${name} seed ${i}`).toBe(false);
      }
    }
  }, 600_000);
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

  it('is orthographic: an off-centre point projects to the same spot at any height', () => {
    // (3.4, y, −2.55) at aspect 4/3: x / 6.8 = 0.5, screen-up is −z so 2.55 / 5.1 = 0.5.
    const m = viewProjection(4 / 3, new Float32Array(16));
    for (const y of [-1, 0, 3, 20]) {
      const [px, py] = project(m, [3.4, y, -2.55]);
      expect(Math.abs(px - 0.5)).toBeLessThan(1e-6);
      expect(Math.abs(py - 0.5)).toBeLessThan(1e-6);
    }
  });

  it('keeps heights −1 to 20 inside the depth range, higher points nearer', () => {
    const m = viewProjection(4 / 3, new Float32Array(16));
    const depth = (y: number): number =>
      ((m[6] ?? Number.NaN) * y + (m[14] ?? Number.NaN)) / (m[15] ?? Number.NaN);
    expect(Math.abs(depth(20) + 1)).toBeLessThan(1e-6);
    expect(Math.abs(depth(-1) - 1)).toBeLessThan(1e-6);
    expect(depth(3)).toBeLessThan(depth(0));
  });

  it('places the camera 14 units above the origin', () => {
    expect(cameraPosition()).toEqual([0, 14, 0]);
  });

  it('returns a frozen camera position', () => {
    expect(Object.isFrozen(cameraPosition())).toBe(true);
  });
});
