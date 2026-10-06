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
import { throwWave } from './throw';
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
    // speed: 0.62 → 9 + 5·0.62 = 12.1.
    // one body (cols 1, across 0, back 1.4): x = −0.6·1.4 + (2·0.95 − 1)·0.15 = −0.84 + 0.135
    //   = −0.705; z = 0.8·1.4 + (2·0.15 − 1)·0.15 = 1.12 − 0.105 = 1.015; y = 2.2 + 0.6·0.35 = 2.41.
    // orientation: (0.99, 0.01, 0.98, 0.02) → (0.98, −0.98, 0.96, −0.96), |u|² > 1, rejected;
    //   (0.6, 0.45, 0.7, 0.4) → (0.2, −0.1, 0.4, −0.2), |u| = 0.5 → (0.4, −0.2, 0.8, −0.4).
    // speed factor 0.8 → along = 12.1·(0.85 + 0.24) = 13.189; lateral 0.3 → −0.4·1.5 = −0.6;
    //   v = h·13.189 + p·(−0.6) = (7.9134 − 0.48, ·, −10.5512 − 0.36) = (7.4334, ·, −10.9112).
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
    expect(state?.velocity).toSatisfy((v: number[]) => near(v, [7.4334, -0.5, -10.9112]));
    expect(state?.angularVelocity).toSatisfy((w: number[]) => near(w, [20, -19, 8]));
  });

  it('rejects near-zero orientation draws and lays out a grid across the heading', () => {
    // heading (0.5, 0.9) → (0, 0.8) → h = (0, 1), p = (−1, 0); speed 0.04 → 9.2. cols = 2,
    // back 1.4: body 0 at across −0.65 → base (0.65, −1.4); body 1 at +0.65 → (−0.65, −1.4).
    // body 0: jitter (0.6, 0.3) → (+0.03, −0.06) → x 0.68, z −1.46; y 0.85 → 2.71;
    //   orientation (0.5001, 0.4999, 0.5003, 0.4997) → |u|² = 8e-7 ≤ 1e-6, rejected;
    //   (0.54, 0.48, 0.58, 0.46) → (0.08, −0.04, 0.16, −0.08), |u| = 0.2 → (0.4, −0.2, 0.8, −0.4);
    //   factor 0.2 → along 9.2·0.91 = 8.372; lateral 0.7 → 0.6; v = (−0.6, ·, 8.372);
    //   vy 0.15 → −0.3; spin (0.96, 0.08, 0.66) → (23, −21, 8).
    // body 1: jitter (0.1, 0.75) → (−0.12, +0.075) → x −0.77, z −1.325; y 0.05 → 2.23;
    //   orientation (0.55, 0.4, 0.625, 0.35) → (0.1, −0.2, 0.25, −0.3), |u| = 0.45
    //   → (2/9, −4/9, 5/9, −2/3); factor 0.8 → along 9.2·1.09 = 10.028; lateral 0.22 → −0.84;
    //   v = (0.84, ·, 10.028); vy 0.65 → −1.3; spin (0.24, 0.88, 0.32) → (−13, 19, −9).
    const rng = scripted([
      0.5, 0.9, 0.04, 0.6, 0.3, 0.85, 0.5001, 0.4999, 0.5003, 0.4997, 0.54, 0.48, 0.58, 0.46, 0.2,
      0.7, 0.15, 0.96, 0.08, 0.66, 0.1, 0.75, 0.05, 0.55, 0.4, 0.625, 0.35, 0.8, 0.22, 0.65, 0.24,
      0.88, 0.32,
    ]);
    const [a, b, ...rest] = throwWave(rng, [0.5, 0.5], BOUNDS);
    expect(rest).toHaveLength(0);
    expect(rng.used()).toBe(33);
    expect(a?.position).toSatisfy((p: number[]) => near(p, [0.68, 2.71, -1.46]));
    expect(a?.orientation).toSatisfy((q: number[]) => near(q, [0.4, -0.2, 0.8, -0.4]));
    expect(a?.velocity).toSatisfy((v: number[]) => near(v, [-0.6, -0.3, 8.372]));
    expect(a?.angularVelocity).toSatisfy((w: number[]) => near(w, [23, -21, 8]));
    expect(b?.position).toSatisfy((p: number[]) => near(p, [-0.77, 2.23, -1.325]));
    expect(b?.orientation).toSatisfy((q: number[]) => near(q, [2 / 9, -4 / 9, 5 / 9, -2 / 3]));
    expect(b?.velocity).toSatisfy((v: number[]) => near(v, [0.84, -1.3, 10.028]));
    expect(b?.angularVelocity).toSatisfy((w: number[]) => near(w, [-13, 19, -9]));
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
    expect(result).toEqual({ totalSteps: 0, tracks: [], settled: true });
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

  it('the crowded golden case moves at least one die apart in the flatten tail', () => {
    const input = GOLDEN_CASES[4];
    expect(input?.shapes).toHaveLength(9);
    if (input === undefined) return;
    const result = simulate(input);
    const moved = result.tracks.some((t) => {
      const end = t.frames.length - 7;
      const rest = end - FLATTEN_STEPS * 7;
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
      tracks: [{ shape: 'd6', wave: 0, startStep: 0, frames: new Float32Array([1]), upReadout: 0 }],
    };
    expect(trackHash(result)).toBe(h.toString(16).padStart(8, '0'));
    expect(trackHash({ totalSteps: 0, settled: true, tracks: [] })).toBe('811c9dc5');
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
