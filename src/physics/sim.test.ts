import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSeedRng } from '../core/rng';
import type { SeedRng } from '../core/rng';
import { getPolyhedron } from '../geometry/polyhedra';
import type { ShapeType } from '../geometry/polyhedra';
import { quatRotate } from '../geometry/vec';
import { FLATTEN_STEPS } from './flatten';
import { GOLDEN_CASES, GOLDEN_HASH, goldenHash } from './golden';
import {
  MAX_STEPS_PER_WAVE,
  SETTLE_ANGULAR,
  SETTLE_LINEAR,
  SETTLE_STEPS,
  simulate,
  trackHash,
} from './sim';
import type { SimInput, SimResult } from './sim';
import { spawnCapacity, throwWave } from './throw';
import type { TrayBounds } from './world';

const BOUNDS: TrayBounds = { minX: -6, maxX: 6, minZ: -4, maxZ: 4 };
const CYCLE: ShapeType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

function settleInput(i: number): SimInput {
  const shapes = Array.from({ length: 10 }, (_, k) => CYCLE[k % CYCLE.length] ?? 'd6');
  return {
    seed: i.toString(16).padStart(32, '0'),
    shapes,
    waves: shapes.map(() => 0),
    bounds: BOUNDS,
  };
}

function near(a: readonly number[] | undefined, b: readonly number[]): boolean {
  return a?.length === b.length && a.every((x, i) => Math.abs(x - (b[i] ?? NaN)) < 1e-12);
}

/** Scripted rng: float() returns the listed values in order. */
function scripted(values: number[]): SeedRng & { used: () => number } {
  let n = 0;
  const float = (): number => {
    const v = values[n++];
    if (v === undefined) throw new Error('script exhausted');
    return v;
  };
  return {
    float,
    u32: () => float() * 2 ** 32,
    int: (m) => Math.floor(float() * m),
    used: () => n,
  };
}

describe('constants', () => {
  it('match the plan', () => {
    expect(MAX_STEPS_PER_WAVE).toBe(720);
    expect(SETTLE_LINEAR).toBe(0.05);
    expect(SETTLE_ANGULAR).toBe(0.1);
    expect(SETTLE_STEPS).toBe(24);
  });
});

describe('throwWave', () => {
  it('draws heading, speed, then per body jitter x/z, y, orientation, speed factor, lateral, vy, spin', () => {
    // Every draw is distinct, so swapping any two draws changes an asserted component.
    // heading: (0.47, 0.53) → (−0.06, 0.06), |h|² = 0.0072 ≤ 0.04, rejected;
    //          (0.74, 0.18) → (0.48, −0.64), |h| = 0.8 → h = (0.6, −0.8), p = (−hz, hx) = (0.8, 0.6).
    // speed: 0.62 → 5 + 3·0.62 = 6.86.
    // one body (cols 1, across 0, back 1.4): x = −0.6·1.4 + (2·0.95 − 1)·0.15 = −0.84 + 0.135
    //   = −0.705; z = 0.8·1.4 + (2·0.15 − 1)·0.15 = 1.12 − 0.105 = 1.015; y = 2.2 + 0.6·0.35 = 2.41.
    // orientation: (0.99, 0.01, 0.98, 0.02) → (0.98, −0.98, 0.96, −0.96), |u|² > 1, rejected;
    //   (0.6, 0.45, 0.7, 0.4) → (0.2, −0.1, 0.4, −0.2), |u| = 0.5 → (0.4, −0.2, 0.8, −0.4).
    // speed factor 0.8 → along = 6.86·(0.85 + 0.24) = 7.4774; lateral 0.3 → −0.4·1.5 = −0.6;
    //   v = h·7.4774 + p·(−0.6) = (4.48644 − 0.48, ·, −5.98192 − 0.36) = (4.00644, ·, −6.34192).
    // vy 0.25 → −0.5. spin (0.9, 0.12, 0.66) → (0.8, −0.76, 0.32)·25 = (20, −19, 8).
    const rng = scripted([
      0.47, 0.53, 0.74, 0.18, 0.62, 0.95, 0.15, 0.35, 0.99, 0.01, 0.98, 0.02, 0.6, 0.45, 0.7, 0.4,
      0.8, 0.3, 0.25, 0.9, 0.12, 0.66,
    ]);
    const [state, ...rest] = throwWave(rng, [0.8], BOUNDS);
    expect(rest).toHaveLength(0);
    expect(rng.used()).toBe(22);
    expect(state?.position).toSatisfy((p: number[]) => near(p, [-0.705, 2.41, 1.015]));
    expect(state?.orientation).toSatisfy((q: number[]) => near(q, [0.4, -0.2, 0.8, -0.4]));
    expect(state?.velocity).toSatisfy((v: number[]) => near(v, [4.00644, -0.5, -6.34192]));
    expect(state?.angularVelocity).toSatisfy((w: number[]) => near(w, [20, -19, 8]));
  });

  it('rejects near-zero orientation draws and lays out a block of columns along x', () => {
    // heading (0.5, 0.9) → (0, 0.8) → h = (0, 1), p = (−1, 0); speed 0.04 → 5 + 3·0.04 = 5.12.
    // rMax 0.5 → d = 1.5, m = 0.75; k = 2 → c = 2, r = 1; back 1.4 → centre (0, −1.4), which fits
    //   (bx = 0.75 + 0.75 = 1.5, bz = 0.75): body 0 base (−0.75, −1.4), body 1 base (0.75, −1.4).
    // body 0: jitter (0.6, 0.3) → (+0.03, −0.06) → x −0.72, z −1.46; y 0.85 → 2.71;
    //   orientation (0.5001, 0.4999, 0.5003, 0.4997) → |u|² = 8e-7 ≤ 1e-6, rejected;
    //   (0.54, 0.48, 0.58, 0.46) → (0.08, −0.04, 0.16, −0.08), |u| = 0.2 → (0.4, −0.2, 0.8, −0.4);
    //   factor 0.2 → along 5.12·0.91 = 4.6592; lateral 0.7 → 0.6; v = (−0.6, ·, 4.6592);
    //   vy 0.15 → −0.3; spin (0.96, 0.08, 0.66) → (23, −21, 8).
    // body 1: jitter (0.1, 0.75) → (−0.12, +0.075) → x 0.63, z −1.325; y 0.05 → 2.23;
    //   orientation (0.55, 0.4, 0.625, 0.35) → (0.1, −0.2, 0.25, −0.3), |u| = 0.45
    //   → (2/9, −4/9, 5/9, −2/3); factor 0.8 → along 5.12·1.09 = 5.5808; lateral 0.22 → −0.84;
    //   v = (0.84, ·, 5.5808); vy 0.65 → −1.3; spin (0.24, 0.88, 0.32) → (−13, 19, −9).
    const rng = scripted([
      0.5, 0.9, 0.04, 0.6, 0.3, 0.85, 0.5001, 0.4999, 0.5003, 0.4997, 0.54, 0.48, 0.58, 0.46, 0.2,
      0.7, 0.15, 0.96, 0.08, 0.66, 0.1, 0.75, 0.05, 0.55, 0.4, 0.625, 0.35, 0.8, 0.22, 0.65, 0.24,
      0.88, 0.32,
    ]);
    const [a, b, ...rest] = throwWave(rng, [0.5, 0.5], BOUNDS);
    expect(rest).toHaveLength(0);
    expect(rng.used()).toBe(33);
    expect(a?.position).toSatisfy((p: number[]) => near(p, [-0.72, 2.71, -1.46]));
    expect(a?.orientation).toSatisfy((q: number[]) => near(q, [0.4, -0.2, 0.8, -0.4]));
    expect(a?.velocity).toSatisfy((v: number[]) => near(v, [-0.6, -0.3, 4.6592]));
    expect(a?.angularVelocity).toSatisfy((w: number[]) => near(w, [23, -21, 8]));
    expect(b?.position).toSatisfy((p: number[]) => near(p, [0.63, 2.23, -1.325]));
    expect(b?.orientation).toSatisfy((q: number[]) => near(q, [2 / 9, -4 / 9, 5 / 9, -2 / 3]));
    expect(b?.velocity).toSatisfy((v: number[]) => near(v, [0.84, -1.3, 5.5808]));
    expect(b?.angularVelocity).toSatisfy((w: number[]) => near(w, [-13, 19, -9]));
  });

  it('centres a later wave on the candidate farthest from resting dice, at 0.4× speed', () => {
    // bx = bz = 0.8 + 0.25 = 1.05, so candidates clamp to x ∈ [−4.95, 4.95], z ∈ [−2.95, 2.95].
    // Dice rest at the left end; x = 4.95 is farthest, and z = −2.95 and z = 2.95 tie at
    // min(8.95² + 2.95², 9.95² + 0.05²) = 88.805, so gj = 0 (z = −2.95) wins.
    const [state] = throwWave(
      createSeedRng('0123456789abcdef0123456789abcdef'),
      [0.8],
      BOUNDS,
      [-5, -3, -5, 3, -4, 0],
    );
    const [x, , z] = state?.position ?? [NaN, NaN, NaN];
    const [vx, , vz] = state?.velocity ?? [NaN, NaN, NaN];
    expect(x).toBeGreaterThan(4.5);
    expect(z).toBeLessThan(-2.5);
    expect(Math.hypot(vx, vz)).toBeLessThanOrEqual(0.4 * (8 * 1.15 + 1.5));
  });

  it('clamps spawn points inside the walls', () => {
    const tiny: TrayBounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
    const states = throwWave(
      createSeedRng('0123456789abcdef0123456789abcdef'),
      Array(9).fill(0.8),
      tiny,
    );
    for (const s of states) {
      expect(Math.abs(s.position[0])).toBeLessThanOrEqual(0.2 + 1e-12);
      expect(Math.abs(s.position[2])).toBeLessThanOrEqual(0.2 + 1e-12);
    }
    const narrow: TrayBounds = { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 };
    for (const s of throwWave(createSeedRng('0123456789abcdef0123456789abcdef'), [0.8], narrow)) {
      expect(s.position[0]).toBe(0);
      expect(s.position[2]).toBe(0);
    }
  });

  it('spawns every wave with no two bounding spheres overlapping, inside the walls', () => {
    const trays: TrayBounds[] = [
      { minX: -6, maxX: 6, minZ: -4, maxZ: 4 },
      { minX: -4.25, maxX: 4.25, minZ: -3, maxZ: 3 },
      { minX: -8.25, maxX: 8.25, minZ: -4.75, maxZ: 4.75 },
      { minX: -6.25, maxX: 6.25, minZ: -6, maxZ: 6 },
    ];
    const mixed = [0.95, 0.8660254037844386, 0.75, 0.75, 0.72, 0.85];
    const radiusLists = [
      (): number => 0.8660254037844386,
      (): number => 0.85,
      (i: number): number => mixed[i % 6] ?? 0,
    ];
    const seeds = [
      '0123456789abcdef0123456789abcdef',
      'fedcba9876543210fedcba9876543210',
      '9e3779b19e3779b19e3779b19e3779b1',
    ];
    for (const b of trays) {
      for (const radiusOf of radiusLists) {
        for (const seed of seeds) {
          for (let count = 1; count <= 30; count++) {
            const radii = Array.from({ length: count }, (_, i) => radiusOf(i));
            const states = throwWave(createSeedRng(seed), radii, b);
            states.forEach((s, i) => {
              const ri = radii[i] ?? 0;
              const [x, y, z] = s.position;
              expect(x).toBeGreaterThanOrEqual(b.minX + ri);
              expect(x).toBeLessThanOrEqual(b.maxX - ri);
              expect(z).toBeGreaterThanOrEqual(b.minZ + ri);
              expect(z).toBeLessThanOrEqual(b.maxZ - ri);
              for (let j = 0; j < i; j++) {
                const o = states[j]?.position ?? [NaN, NaN, NaN];
                const dist = Math.hypot(x - o[0], y - o[1], z - o[2]);
                expect(dist, `${seed} count ${count} bodies ${j},${i}`).toBeGreaterThanOrEqual(
                  ri + (radii[j] ?? 0),
                );
              }
            });
          }
        }
      }
    }
  });

  // trayBounds(608/360, 2); d6 circumradius √3/2: d = 2·0.866 + 0.5 = 2.232, m = 0.866 + 0.25 = 1.116,
  // fitX = floor((7 − 2.232)/2.232) + 1 = 3, fitZ = floor((3.5 − 2.232)/2.232) + 1 = 1.
  const ONE_ROW: TrayBounds = { minX: -3.5, maxX: 3.5, minZ: -1.75, maxZ: 1.75 };
  const D6_R = Math.sqrt(3) / 2;

  it('fills a row before stacking a layer', () => {
    const states = throwWave(
      createSeedRng('0123456789abcdef0123456789abcdef'),
      [D6_R, D6_R, D6_R],
      ONE_ROW,
    );
    const xs = states.map((s) => s.position[0]);
    for (const s of states) {
      expect(s.position[1]).toBeGreaterThanOrEqual(2.2);
      expect(s.position[1]).toBeLessThan(2.8);
    }
    // Column spacing 2.232 less the worst jitter 2·0.15.
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < i; j++) {
        expect(Math.abs((xs[i] ?? NaN) - (xs[j] ?? NaN))).toBeGreaterThan(1.93);
      }
    }
  });

  it('stacks a die in a higher layer only once the floor grid is full', () => {
    const states = throwWave(
      createSeedRng('0123456789abcdef0123456789abcdef'),
      [D6_R, D6_R, D6_R, D6_R],
      ONE_ROW,
    );
    // Layer 1 starts at 2.2 + 2·0.866 + 1.1 = 5.032.
    expect(states.map((s) => s.position[1] >= 5.03)).toEqual([false, false, false, true]);
  });

  it('reports the one-layer spawn capacity', () => {
    expect(spawnCapacity(D6_R, ONE_ROW)).toBe(3);
    // fitX = floor((8.5 − 2.232)/2.232) + 1 = 3, fitZ = floor((4.5 − 2.232)/2.232) + 1 = 2.
    expect(spawnCapacity(D6_R, { minX: -4.25, maxX: 4.25, minZ: -2.25, maxZ: 2.25 })).toBe(6);
  });

  it('stays within the documented ranges for seeded draws', () => {
    const states = throwWave(
      createSeedRng('fedcba9876543210fedcba9876543210'),
      Array(10).fill(0.75),
      BOUNDS,
    );
    for (const s of states) {
      expect(s.position[1]).toBeGreaterThanOrEqual(2.2);
      expect(s.position[1]).toBeLessThan(2.8);
      const [x, y, z, w] = s.orientation;
      expect(Math.abs(x * x + y * y + z * z + w * w - 1)).toBeLessThan(1e-12);
      expect(s.velocity[1]).toBeLessThanOrEqual(0);
      expect(s.velocity[1]).toBeGreaterThan(-2);
      for (const c of s.angularVelocity) expect(Math.abs(c)).toBeLessThanOrEqual(25);
      expect(s.position[0]).toBeGreaterThanOrEqual(-6 + 0.75);
      expect(s.position[0]).toBeLessThanOrEqual(6 - 0.75);
    }
  });
});

describe('simulate', () => {
  it('returns no tracks for no dice', () => {
    const result = simulate({ seed: '0'.repeat(32), shapes: [], waves: [], bounds: BOUNDS });
    expect(result).toEqual({
      totalSteps: 0,
      tracks: [],
      settled: true,
      attempts: 1,
      stacked: false,
      tailSteps: 0,
    });
  });

  it('rejects mismatched shapes and waves', () => {
    expect(() =>
      simulate({ seed: '0'.repeat(32), shapes: ['d6'], waves: [], bounds: BOUNDS }),
    ).toThrow(RangeError);
  });

  it('records a spawn frame and one frame per step, and reads the final up-face', () => {
    const input = settleInput(0);
    const result = simulate(input);
    const spawn = throwWave(
      createSeedRng(input.seed),
      input.shapes.map((s) => getPolyhedron(s).radius),
      BOUNDS,
    );
    expect(result.settled).toBe(true);
    expect(result.tracks).toHaveLength(10);
    result.tracks.forEach((track, i) => {
      expect(track.shape).toBe(input.shapes[i]);
      expect(track.startStep).toBe(0);
      expect(track.wave).toBe(0);
      expect(track.frames.length).toBe((result.totalSteps + 1) * 7);
      const s = spawn[i];
      expect(Array.from(track.frames.subarray(0, 3))).toEqual(s?.position.map(Math.fround));
      expect(Array.from(track.frames.subarray(3, 7))).toEqual(s?.orientation.map(Math.fround));
      const last = track.frames.subarray(track.frames.length - 7);
      const q = [last[3] ?? 0, last[4] ?? 0, last[5] ?? 0, last[6] ?? 0] as const;
      const ys = getPolyhedron(track.shape).readouts.map((r) => quatRotate(q, r)[1]);
      expect(track.upReadout).toBe(ys.indexOf(Math.max(...ys)));
    });
  });

  it('throws each wave after the previous one settles; earlier dice keep their frames', () => {
    const input = GOLDEN_CASES[2];
    expect(input?.waves).toEqual([0, 1, 2]);
    if (input === undefined) return;
    const result = simulate(input);
    const [a, b, c] = result.tracks;
    expect(a?.startStep).toBe(0);
    expect(b?.startStep).toBeGreaterThanOrEqual(SETTLE_STEPS);
    expect(c?.startStep).toBeGreaterThan((b?.startStep ?? 0) + SETTLE_STEPS - 1);
    for (const t of result.tracks) {
      expect(t.frames.length).toBe((result.totalSteps - t.startStep + 1) * 7);
    }
    expect(result.tracks.map((t) => t.wave)).toEqual([0, 1, 2]);
  });

  it('throws a later wave clear of the resting dice', () => {
    const result = simulate({
      seed: '00000000000000000000000000000001',
      shapes: ['d6', 'd6', 'd6', 'd6', 'd6'],
      waves: [0, 0, 0, 1, 2],
      bounds: BOUNDS,
    });
    const late = result.tracks[3];
    expect(late?.wave).toBe(1);
    if (late === undefined) return;
    for (const t of result.tracks.slice(0, 3)) {
      const at = (late.startStep - t.startStep) * 7;
      const dx = (late.frames[0] ?? NaN) - (t.frames[at] ?? NaN);
      const dz = (late.frames[2] ?? NaN) - (t.frames[at + 2] ?? NaN);
      expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(2 * getPolyhedron('d6').radius);
    }
  });

  it('orders waves by value and keeps input order for tracks', () => {
    const result = simulate({
      seed: '00000000000000000000000000000002',
      shapes: ['d8', 'd6', 'd4'],
      waves: [3, 1, 3],
      bounds: BOUNDS,
    });
    expect(result.tracks.map((t) => t.shape)).toEqual(['d8', 'd6', 'd4']);
    expect(result.tracks[1]?.startStep).toBe(0);
    expect(result.tracks[0]?.startStep).toBeGreaterThan(0);
    expect(result.tracks[0]?.startStep).toBe(result.tracks[2]?.startStep);
  });

  it('re-simulates a roll that ends with a die resting on another', () => {
    // Seed 0xee5 found by search: its first attempt ends with a d6 resting on another.
    const input: SimInput = {
      seed: '00000000000000000000000000000ee5',
      shapes: Array<ShapeType>(6).fill('d6'),
      waves: [0, 0, 0, 0, 0, 0],
      bounds: { minX: -4.25, maxX: 4.25, minZ: -2.25, maxZ: 2.25 },
    };
    const result = simulate(input);
    expect(result.attempts).toBeGreaterThanOrEqual(2);
    expect(result.stacked).toBe(false);
    expect(trackHash(simulate(input))).toBe(trackHash(result));
  });

  it('keeps the first attempt of a one-die roll', () => {
    const result = simulate({ seed: '0'.repeat(32), shapes: ['d6'], waves: [0], bounds: BOUNDS });
    expect(result.attempts).toBe(1);
    expect(result.stacked).toBe(false);
  });

  it('reports settled: false when a wave hits the step cap', () => {
    const tight: TrayBounds = { minX: -0.2, maxX: 0.2, minZ: -0.2, maxZ: 0.2 };
    const result = simulate({
      seed: '0'.repeat(32),
      shapes: ['d20', 'd20'],
      waves: [0, 0],
      bounds: tight,
    });
    expect(result.settled).toBe(false);
    // The jammed d20s rest cocked, so the roll gains the flatten tail.
    expect(result.totalSteps).toBe(MAX_STEPS_PER_WAVE + FLATTEN_STEPS);
  });
});

describe('determinism', () => {
  it('produces byte-identical frames for repeated runs of every golden case', () => {
    for (const input of GOLDEN_CASES) {
      const a = simulate(input);
      const b = simulate(input);
      expect(b.totalSteps).toBe(a.totalSteps);
      a.tracks.forEach((t, i) => {
        const u = b.tracks[i];
        expect(u).toBeDefined();
        if (u === undefined) return;
        expect(Buffer.from(u.frames.buffer).equals(Buffer.from(t.frames.buffer))).toBe(true);
      });
    }
  });

  it('matches the golden trajectory hash', () => {
    expect(GOLDEN_CASES).toHaveLength(5);
    expect(goldenHash()).toBe(GOLDEN_HASH);
    expect(GOLDEN_HASH).toMatch(/^[0-9a-f]{8}$/);
  });

  it('reports tailSteps 0 for a die that settles flat, FLATTEN_STEPS for the crowded case', () => {
    const single = simulate({ seed: '0'.repeat(32), shapes: ['d6'], waves: [0], bounds: BOUNDS });
    const crowded = GOLDEN_CASES[4];
    if (crowded === undefined) throw new Error('missing crowded golden case');
    expect(single.tailSteps).toBe(0);
    expect(simulate(crowded).tailSteps).toBe(FLATTEN_STEPS);
  });

  it('the crowded golden case moves at least one die apart in the flatten tail', () => {
    const input = GOLDEN_CASES[4];
    expect(input?.shapes).toHaveLength(9);
    if (input === undefined) return;
    const result = simulate(input);
    const moved = result.tracks.some((t) => {
      const end = t.frames.length - 7;
      const rest = end - result.tailSteps * 7;
      const dx = (t.frames[end] ?? 0) - (t.frames[rest] ?? 0);
      const dz = (t.frames[end + 2] ?? 0) - (t.frames[rest + 2] ?? 0);
      // Settled dice drift under 0.05 units/s, far less than 0.05 units over the tail.
      return dx * dx + dz * dz > 0.05 * 0.05;
    });
    expect(moved).toBe(true);
  });

  it('different seeds give different hashes', () => {
    const a = trackHash(simulate(settleInput(1)));
    const b = trackHash(simulate(settleInput(2)));
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it('trackHash is FNV-1a over the frame words, low byte first', () => {
    // One frame word 0x3f800000 (1.0f): bytes 00 00 80 3f. FNV-1a 32 of those bytes, by hand:
    // offset 0x811c9dc5, prime 0x01000193.
    let h = 0x811c9dc5;
    for (const byte of [0x00, 0x00, 0x80, 0x3f]) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
    const result: SimResult = {
      totalSteps: 0,
      settled: true,
      attempts: 1,
      stacked: false,
      tailSteps: 0,
      tracks: [{ shape: 'd6', wave: 0, startStep: 0, frames: new Float32Array([1]), upReadout: 0 }],
    };
    expect(trackHash(result)).toBe(h.toString(16).padStart(8, '0'));
    expect(trackHash({ ...result, tracks: [] })).toBe('811c9dc5');
  });
});

describe('settle acceptance', () => {
  it('settles all 50 ten-dice throws with median <= 400 steps', () => {
    const steps: number[] = [];
    let settled = 0;
    for (let i = 0; i < 50; i++) {
      const result = simulate(settleInput(i));
      if (result.settled) settled++;
      steps.push(result.totalSteps);
    }
    steps.sort((x, y) => x - y);
    const median = ((steps[24] ?? 0) + (steps[25] ?? 0)) / 2;
    expect(settled).toBe(50);
    expect(median).toBeLessThanOrEqual(400);
  }, 60_000);

  it.each([
    [30, 53, { minX: -8.25, maxX: 8.25, minZ: -4.75, maxZ: 4.75 }],
    [30, 98, { minX: -8.25, maxX: 8.25, minZ: -4.75, maxZ: 4.75 }],
    [30, 161, { minX: -8.25, maxX: 8.25, minZ: -4.75, maxZ: 4.75 }],
    [20, 79, { minX: -6.75, maxX: 6.75, minZ: -3.75, maxZ: 3.75 }],
    [20, 183, { minX: -6.75, maxX: 6.75, minZ: -3.75, maxZ: 3.75 }],
  ])('settles %id6 seed %i in its fit-scale tray', (count, i, bounds) => {
    // Pins trajectories that jittered to the step cap before feature-keyed warm-start slots.
    const shapes = Array<ShapeType>(count).fill('d6');
    const seed = i.toString(16).padStart(32, '0');
    expect(simulate({ seed, shapes, waves: shapes.map(() => 0), bounds }).settled).toBe(true);
  });
});

describe('static guard', () => {
  it('uses no forbidden math or clock in src/physics', () => {
    const dir = fileURLToPath(new URL('./', import.meta.url));
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.bench.ts'),
    );
    expect(files.length).toBeGreaterThanOrEqual(5);
    const forbidden =
      /Math\.(sin|cos|tan|atan2?|asin|acos|exp|pow|log|random|fround)\b|Date\b|performance\./;
    for (const f of files) {
      expect(forbidden.test(readFileSync(dir + f, 'utf8')), f).toBe(false);
    }
  });
});
