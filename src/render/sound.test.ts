import { describe, expect, it } from 'vitest';
import { impacts, playImpacts } from './sound';

const DT = 1 / 120;

/** Keyframes (identity orientation) for n steps with position pos(k). */
function body(startStep: number, n: number, pos: (k: number) => [number, number, number]) {
  const frames = new Float32Array(n * 7);
  for (let k = 0; k < n; k++) frames.set([...pos(k), 0, 0, 0, 1], k * 7);
  return { startStep, frames };
}

/** A body resting at y = 0.5 whose x velocity steps through `v` (index = frame), 0 beyond it. */
function kicked(n: number, v: (k: number) => number) {
  let x = 0;
  return body(0, n, (k) => {
    if (k > 0) x += v(k) * DT;
    return [x, 0.5, 0];
  });
}

function pairs(list: Float32Array): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < list.length; i += 2) out.push([list[i] ?? NaN, list[i + 1] ?? NaN]);
  return out;
}

describe('impacts', () => {
  it('finds one impact at the landing step of a body dropped from y = 3 onto y = 0.5', () => {
    // Free fall y = 3 − 15t² reaches 0.6 at frame 48 and is clamped from frame 49 on;
    // landing speed √(2 · 30 · 2.5) ≈ 12.25 units/s; frame 49 is global step 10 + 49.
    const fall = body(10, 120, (k) => [0, Math.max(0.5, 3 - 15 * (k * DT) ** 2), 0]);
    const found = pairs(impacts([fall], 36));
    expect(found).toHaveLength(1);
    const [step, strength] = found[0] ?? [NaN, NaN];
    expect(step).toBe(59);
    expect(strength).toBeGreaterThan(12.25 * 0.9);
    expect(strength).toBeLessThan(12.25 * 1.1);
  });

  it('finds no impact for a body resting at constant height (|Δv| = 30 · DT = 0.25)', () => {
    expect(impacts([body(0, 60, () => [0, 0.5, 0])], 36)).toHaveLength(0);
  });

  it.each([
    [1.9, []],
    [2.1, [20]],
  ])('records a kick of %f units/s at frames %j (threshold 2)', (speed, steps) => {
    const found = pairs(impacts([kicked(60, (k) => (k > 20 ? speed : 0))], 36));
    expect(found.map((p) => p[0])).toEqual(steps);
  });

  it.each([
    [3, [[20, Math.sqrt(25 + 0.0625)]]],
    [
      6,
      [
        [20, Math.sqrt(25 + 0.0625)],
        [26, Math.sqrt(100 + 0.0625)],
      ],
    ],
  ])('keeps a second hit %i steps after the first only past the cooldown', (gap, expected) => {
    // +5 units/s from frame 21, −5 from frame 21 + gap: kicks at frames 20 and 20 + gap.
    const b = kicked(80, (k) => (k > 20 + gap ? -5 : k > 20 ? 5 : 0));
    const found = pairs(impacts([b], 36));
    expect(found).toHaveLength(expected.length);
    found.forEach(([step, strength], i) => {
      expect(step).toBe(expected[i]?.[0]);
      expect(strength).toBeCloseTo(expected[i]?.[1] ?? NaN, 2);
    });
  });

  it.each([
    // A 36-step tail plus the last frame: 60 − 37 = 23 is the first ignored frame.
    [22, 36, [22]],
    [23, 36, []],
    // No tail: only the last frame is ignored, so a kick 10 steps before the end counts.
    [50, 0, [50]],
  ])('kick at frame %i of 60 with tailSteps %i is found at %j', (frame, tail, steps) => {
    const found = pairs(impacts([kicked(60, (k) => (k > frame ? 5 : 0))], tail));
    expect(found.map((p) => p[0])).toEqual(steps);
  });

  it('keeps the 48 strongest of 60 impacts in step order', () => {
    // Body i is kicked to i + 3 units/s at step 20 + 59 − i, so stronger bodies hit earlier.
    const bodies = Array.from({ length: 60 }, (_, i) =>
      kicked(120, (k) => (k > 79 - i ? i + 3 : 0)),
    );
    const found = pairs(impacts(bodies, 36));
    expect(found.map((p) => p[0])).toEqual(Array.from({ length: 48 }, (_, j) => 20 + j));
    found.forEach(([, strength], j) => {
      expect(strength).toBeCloseTo(Math.sqrt((62 - j) ** 2 + 0.0625), 2);
    });
  });
});

describe('playImpacts', () => {
  it('starts an impact at step 120 played at rate 1.5 at start + 2/3 s', () => {
    const starts: number[] = [];
    const node = <T extends object>(props: T) => ({ ...props, connect: <N>(n: N): N => n });
    const ctx = {
      destination: {},
      createBufferSource: () =>
        node({ buffer: null, start: (when: number) => starts.push(when), stop: () => undefined }),
      createBiquadFilter: () => node({ type: '', frequency: { value: 0 }, Q: { value: 0 } }),
      createGain: () => node({ gain: { value: 0 } }),
    };
    // Boundary fake: only the AudioContext members playImpacts uses.
    const fake = ctx as unknown as AudioContext;
    playImpacts(fake, {} as AudioBuffer, new Float32Array([120, 15]), 10, 1, 1.5);
    expect(starts).toHaveLength(1);
    expect(starts[0]).toBeCloseTo(10 + 2 / 3, 9);
  });
});
