import { describe, expect, it } from 'vitest';
import { clackStarts, impacts, playClacks, playImpacts } from './sound';
import type { ClackSet } from './sound';

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

/** Boundary fake: only the AudioContext members playImpacts and playClacks use; records starts. */
function fakeAudio(currentTime: number) {
  const calls: { buffer: unknown; args: number[]; rate: number }[] = [];
  const gains: { value: number }[] = [];
  let filters = 0;
  const node = <T extends object>(props: T) => ({ ...props, connect: <N>(n: N): N => n });
  const ctx = {
    currentTime,
    destination: {},
    createBufferSource: () => {
      const src = node({
        buffer: null,
        playbackRate: { value: 1 },
        start: (...args: number[]) =>
          calls.push({ buffer: src.buffer, args, rate: src.playbackRate.value }),
        stop: () => undefined,
      });
      return src;
    },
    createBiquadFilter: () => {
      filters++;
      return node({ type: '', frequency: { value: 0 }, Q: { value: 0 } });
    },
    createGain: () => {
      const gain = { value: 0 };
      gains.push(gain);
      return node({ gain });
    },
  };
  return { ctx: ctx as unknown as AudioContext, calls, gains, filters: () => filters };
}

describe('playImpacts', () => {
  it('starts an impact at step 120 played at rate 1.5 at start + 2/3 s', () => {
    const { ctx, calls } = fakeAudio(0);
    playImpacts(ctx, {} as AudioBuffer, new Float32Array([120, 15]), 10, 1, 1.5);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]).toBeCloseTo(10 + 2 / 3, 9);
  });

  it('skips impacts that fall before currentTime', () => {
    const { ctx, calls } = fakeAudio(10.5);
    // At start 10 and rate 1.5, steps 0 and 120 fall at 10 and 10.667 s.
    const list = new Float32Array([0, 15, 120, 15]);
    const sources = playImpacts(ctx, {} as AudioBuffer, list, 10, 1, 1.5);
    expect(sources).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]).toBeCloseTo(10 + 2 / 3, 9);
  });
});

describe('clackStarts', () => {
  it('measures clack starts from the first sample above 20% of the peak, clamped at 0', () => {
    // 16 kHz: a 0.01 blip at sample 100 stays under 20% of the 1.0 spike at 66 ms (sample 1056).
    const data = new Float32Array(16000 * 0.2);
    data[100] = 0.01;
    data[1056] = -1;
    const set: ClackSet = {
      audio: '',
      clacks: [
        [-0.8, 61],
        [70.2, 47],
        [-100, 10],
      ],
    };
    const starts = clackStarts(data, 16000, set);
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBeCloseTo(0.066 - 0.0008, 9);
    expect(starts[1]).toBeCloseTo(0.066 + 0.0702, 9);
    expect(starts[2]).toBe(0);
  });

  it('anchors at the spike, not at pre-echo at 10% of the peak 3 ms before it', () => {
    // 16 kHz: pre-echo 0.1 at 63 ms (sample 1008), full spike at 66 ms (sample 1056).
    const data = new Float32Array(16000 * 0.2);
    data[1008] = 0.1;
    data[1056] = 1;
    const set: ClackSet = { audio: '', clacks: [[10, 20]] };
    expect(clackStarts(data, 16000, set)[0]).toBeCloseTo(0.066 + 0.01, 9);
  });
});

describe('playClacks', () => {
  it('plays clack (i · 5 + 1) % n per impact with varied rate and strength gain, skipping past ones', () => {
    const { ctx, calls, gains, filters } = fakeAudio(10.5);
    const buffer = {} as AudioBuffer;
    const set: ClackSet = {
      audio: '',
      clacks: Array.from({ length: 7 }, (_, k): [number, number] => [k * 10, 20 + k]),
    };
    const starts = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    // At start 10 and rate 1.5, steps 0, 120, 240, 360 fall at 10, 10.667, 11.333, 12 s.
    const list = new Float32Array([0, 15, 120, 15, 240, 7.5, 360, 30]);
    const sources = playClacks(ctx, buffer, starts, set, list, 10, 0.8, 1.5);
    expect(sources).toHaveLength(3);
    // Impacts 1, 2, 3: clacks 6, 4, 2; rates 0.94 + 0.12 · (7, 1, 8) / 12.
    const expected = [
      { when: 10 + 2 / 3, offset: 0.6, duration: 0.026, rate: 1.01, gain: 0.8 },
      { when: 10 + 4 / 3, offset: 0.4, duration: 0.024, rate: 0.95, gain: 0.4 },
      { when: 12, offset: 0.2, duration: 0.022, rate: 1.02, gain: 0.8 },
    ];
    expect(calls).toHaveLength(3);
    expect(filters()).toBe(0);
    calls.forEach((c, i) => {
      const e = expected[i];
      expect(c.buffer).toBe(buffer);
      expect(c.args).toHaveLength(3);
      expect(c.args[0]).toBeCloseTo(e?.when ?? NaN, 9);
      expect(c.args[1]).toBeCloseTo(e?.offset ?? NaN, 9);
      expect(c.args[2]).toBeCloseTo(e?.duration ?? NaN, 9);
      expect(c.rate).toBeCloseTo(e?.rate ?? NaN, 9);
      expect(gains[i]?.value).toBeCloseTo(e?.gain ?? NaN, 9);
    });
  });
});
