import { describe, expect, it } from 'vitest';
import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { quatRotate } from '../geometry/vec';
import type { Quat, Vec3 } from '../geometry/vec';
import { DT, createWorld } from './world';
import type { TrayBounds, World } from './world';

const BOUNDS: TrayBounds = { minX: -6, maxX: 6, minZ: -4, maxZ: 4 };
const ZERO: Vec3 = [0, 0, 0];
const ID: Quat = [0, 0, 0, 1];
const pose = new Float64Array(7);

function poseOf(world: World, i: number): { p: Vec3; q: Quat } {
  world.read(i, pose, 0);
  return {
    p: [pose[0] ?? NaN, pose[1] ?? NaN, pose[2] ?? NaN],
    q: [pose[3] ?? NaN, pose[4] ?? NaN, pose[5] ?? NaN, pose[6] ?? NaN],
  };
}

/** Lowest world y over the hull vertices of body i. */
function lowestY(world: World, i: number, shape: ShapeType): number {
  const { p, q } = poseOf(world, i);
  let min = Infinity;
  for (const v of getPolyhedron(shape).vertices) min = Math.min(min, p[1] + quatRotate(q, v)[1]);
  return min;
}

/** Readout index with the largest world y, and that y. */
function upReadout(world: World, i: number, shape: ShapeType): { index: number; y: number } {
  const { q } = poseOf(world, i);
  let index = -1;
  let y = -Infinity;
  getPolyhedron(shape).readouts.forEach((r, k) => {
    const ry = quatRotate(q, r)[1];
    if (ry > y) {
      y = ry;
      index = k;
    }
  });
  return { index, y };
}

function allFinite(world: World, limit: number): boolean {
  const buf = new Float64Array(7);
  for (let i = 0; i < world.count; i++) {
    world.read(i, buf, 0);
    for (const c of buf) if (!Number.isFinite(c) || Math.abs(c) >= limit) return false;
    if (!Number.isFinite(world.linearSpeedSq(i)) || !Number.isFinite(world.angularSpeedSq(i))) {
      return false;
    }
  }
  return true;
}

function axisAngle(axis: Vec3, degrees: number): Quat {
  const half = (degrees * Math.PI) / 360;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

describe('world: basic correctness', () => {
  it('free fall for 1 s matches semi-implicit Euler', () => {
    const world = createWorld(BOUNDS, { linearDamping: 0 });
    world.add('d6', [0, 100, 0], ID, ZERO, ZERO);
    let prevY = 100;
    for (let s = 0; s < 120; s++) {
      prevY = poseOf(world, 0).p[1];
      world.step();
    }
    const y = poseOf(world, 0).p[1];
    let drop = 0;
    for (let k = 1; k <= 120; k++) drop += 30 * k * (1 / 120) * (1 / 120);
    expect(Math.abs(100 - y - drop)).toBeLessThan(1e-6);
    expect(Math.abs((y - prevY) / (1 / 120) + 30)).toBeLessThan(1e-9);
    expect(Math.abs(Math.sqrt(world.linearSpeedSq(0)) - 30)).toBeLessThan(1e-9);
    expect(DT).toBe(1 / 120);
  });

  it('a d6 resting flat stays put and reads its +Y face', () => {
    const world = createWorld(BOUNDS);
    world.add('d6', [0, 0.5, 0], ID, ZERO, ZERO);
    for (let s = 0; s < 240; s++) world.step();
    const { p, q } = poseOf(world, 0);
    expect(Math.abs(p[0])).toBeLessThan(0.01);
    expect(Math.abs(p[1] - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(p[2])).toBeLessThan(0.01);
    expect(Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2])).toBeLessThan(0.01);
    const up = upReadout(world, 0, 'd6');
    const r = getPolyhedron('d6').readouts[up.index];
    expect(r).toBeDefined();
    expect(Math.abs((r?.[1] ?? 0) - 1)).toBeLessThan(1e-12);
  });
});

describe('world: edge cases', () => {
  it('a d6 balanced 1 degree off its edge falls onto a face', () => {
    const world = createWorld(BOUNDS);
    const q = axisAngle([0, 0, 1], 46);
    let min = Infinity;
    for (const v of getPolyhedron('d6').vertices) min = Math.min(min, quatRotate(q, v)[1]);
    world.add('d6', [0, -min, 0], q, ZERO, ZERO);
    for (let s = 0; s < 600; s++) world.step();
    expect(upReadout(world, 0, 'd6').y).toBeGreaterThan(0.99);
    expect(world.linearSpeedSq(0)).toBeLessThan(0.05 * 0.05);
    expect(world.angularSpeedSq(0)).toBeLessThan(0.1 * 0.1);
  });

  it('30 bodies spawned at once stay finite; a 31st throws RangeError', () => {
    const world = createWorld(BOUNDS);
    const shapes: ShapeType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    for (let i = 0; i < 30; i++) {
      const shape = shapes[i % shapes.length] ?? 'd6';
      world.add(
        shape,
        [(i % 6) - 2.5, 1 + (i % 5) * 0.3, (i % 5) - 2],
        ID,
        [i - 15, 0, 15 - i],
        [i, -i, 1],
      );
    }
    expect(world.count).toBe(30);
    expect(() => world.add('d6', [0, 1, 0], ID, ZERO, ZERO)).toThrow(RangeError);
    for (let s = 0; s < 240; s++) {
      world.step();
      expect(allFinite(world, 1e6)).toBe(true);
    }
  });

  it('a zero-velocity body sitting on the floor stays finite', () => {
    const world = createWorld(BOUNDS);
    world.add('d4', [0, 0.25, 0], ID, ZERO, ZERO);
    for (let s = 0; s < 240; s++) world.step();
    expect(allFinite(world, 1e6)).toBe(true);
    expect(lowestY(world, 0, 'd4')).toBeGreaterThan(-0.05);
  });

  it('two coincident bodies separate without NaN', () => {
    const world = createWorld(BOUNDS, { gravity: 0 });
    world.add('d20', [0, 3, 0], ID, ZERO, ZERO);
    world.add('d20', [0, 3, 0], ID, ZERO, ZERO);
    for (let s = 0; s < 120; s++) world.step();
    expect(allFinite(world, 1e6)).toBe(true);
    expect(Math.abs(poseOf(world, 0).p[1] - poseOf(world, 1).p[1])).toBeGreaterThan(0.5);
  });

  it('normalizes the spawn orientation; a zero quaternion becomes identity', () => {
    const world = createWorld(BOUNDS);
    world.add('d6', [0, 5, 0], [0, 0, 0, 0], ZERO, ZERO);
    world.add('d6', [3, 5, 0], [0, 0, 2, 0], ZERO, ZERO);
    expect(poseOf(world, 0).q).toEqual([0, 0, 0, 1]);
    expect(poseOf(world, 1).q).toEqual([0, 0, 1, 0]);
    expect(() => world.read(2, pose, 0)).toThrow(RangeError);
    expect(() => world.linearSpeedSq(-1)).toThrow(RangeError);
  });

  it('a step with no bodies is a no-op', () => {
    const world = createWorld(BOUNDS);
    world.step();
    expect(world.count).toBe(0);
  });
});

describe('world: stability', () => {
  it('10 dice for 720 steps stay finite and bounded', () => {
    const world = createWorld(BOUNDS);
    const shapes: ShapeType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    for (let i = 0; i < 10; i++) {
      world.add(
        shapes[i % shapes.length] ?? 'd6',
        [-4 + i * 0.9, 2 + (i % 3) * 0.5, (i % 4) - 1.5],
        axisAngle([0.6, 0.8, 0], i * 31),
        [12 - i * 2, -2, (i % 2) * 6 - 3],
        [20, -15 + i * 3, 10],
      );
    }
    for (let s = 0; s < 720; s++) {
      world.step();
      expect(allFinite(world, 1e6)).toBe(true);
    }
  });

  it('a spinning d6 dropped from y = 3 never gains more than 10% energy', () => {
    const world = createWorld(BOUNDS);
    const omega: Vec3 = [8, -5, 12];
    world.add('d6', [0, 3, 0], axisAngle([1, 0, 0], 20), [2, 0, -1], omega);
    const moment = 1 / 6; // solid cube of edge 1 and mass 1
    const energy = (): number =>
      0.5 * world.linearSpeedSq(0) +
      0.5 * moment * world.angularSpeedSq(0) +
      30 * poseOf(world, 0).p[1];
    const initial = energy();
    for (let s = 0; s < 720; s++) {
      world.step();
      expect(energy()).toBeLessThanOrEqual(initial * 1.1);
    }
  });
});

describe('world: collision', () => {
  it('a flat d6 dropped from y = 2.5 rebounds at 0.35 x impact speed (+-20%)', () => {
    const world = createWorld(BOUNDS);
    world.add('d6', [0, 2.5, 0], ID, ZERO, ZERO);
    let impact = 0;
    let rebound = 0;
    let prevY = 2.5;
    for (let s = 0; s < 240; s++) {
      world.step();
      const y = poseOf(world, 0).p[1];
      if (y > prevY) {
        rebound = (y - prevY) / DT;
        break;
      }
      impact = Math.max(impact, Math.sqrt(world.linearSpeedSq(0)));
      prevY = y;
    }
    expect(impact).toBeGreaterThan(10);
    expect(rebound).toBeGreaterThan(0.35 * impact * 0.8);
    expect(rebound).toBeLessThan(0.35 * impact * 1.2);
  });

  it('a dropped d6 never sinks more than 0.05 below the floor once resting', () => {
    const world = createWorld(BOUNDS);
    world.add('d6', [0, 2.5, 0], ID, ZERO, ZERO);
    for (let s = 0; s < 240; s++) world.step();
    for (let s = 0; s < 240; s++) {
      world.step();
      expect(lowestY(world, 0, 'd6')).toBeGreaterThan(-0.05);
    }
  });

  it('friction slows a sliding d6 without reversing it', () => {
    const world = createWorld(BOUNDS);
    world.add('d6', [-3, 0.5, 0], ID, [5, 0, 0], ZERO);
    let prevX = -3;
    for (let s = 0; s < 240; s++) {
      world.step();
      const x = poseOf(world, 0).p[0];
      // Allow 1e-4 units/s of Gauss-Seidel residual (unconverged resting impulses), 5e4x below
      // the initial speed; a reversal from friction overshoot would be of order 0.1.
      expect((x - prevX) / DT).toBeGreaterThanOrEqual(-1e-4);
      prevX = x;
    }
    expect(world.linearSpeedSq(0)).toBeLessThan(0.05 * 0.05);
    expect(prevX).toBeGreaterThan(-3);
    expect(prevX).toBeLessThan(6);
  });

  it('walls keep a fast die inside the tray', () => {
    const world = createWorld(BOUNDS);
    world.add('d8', [0, 0.8, 0], ID, [40, 0, 30], ZERO);
    for (let s = 0; s < 480; s++) {
      world.step();
      const { p } = poseOf(world, 0);
      expect(Math.abs(p[0])).toBeLessThan(6.1);
      expect(Math.abs(p[2])).toBeLessThan(4.1);
    }
  });

  it('two dice approaching head-on separate', () => {
    const world = createWorld(BOUNDS, { gravity: 0 });
    world.add('d20', [-1.5, 3, 0], ID, [3, 0, 0], ZERO);
    world.add('d20', [1.5, 3, 0], ID, [-3, 0, 0], ZERO);
    let minGap = Infinity;
    for (let s = 0; s < 180; s++) {
      world.step();
      minGap = Math.min(minGap, poseOf(world, 1).p[0] - poseOf(world, 0).p[0]);
    }
    const gap = poseOf(world, 1).p[0] - poseOf(world, 0).p[0];
    expect(minGap).toBeLessThan(1.6);
    expect(gap).toBeGreaterThan(3);
    expect(Math.abs(poseOf(world, 0).p[1] - 3)).toBeLessThan(1e-9);
  });

  it('clamps restitution above 1 so a drop never rebounds faster than it hit', () => {
    const world = createWorld(BOUNDS, { restitution: 5, linearDamping: -1, angularDamping: -1 });
    world.add('d6', [0, 2.5, 0], ID, ZERO, ZERO);
    let impact = 0;
    let prevY = 2.5;
    for (let s = 0; s < 240; s++) {
      world.step();
      const y = poseOf(world, 0).p[1];
      if (y > prevY) {
        expect((y - prevY) / DT).toBeLessThan(impact * 1.05);
        return;
      }
      impact = Math.max(impact, Math.sqrt(world.linearSpeedSq(0)));
      prevY = y;
    }
    throw new Error('no rebound');
  });
});
