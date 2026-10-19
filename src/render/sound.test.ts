import { describe, expect, it } from 'vitest';
import { planRoll } from '../physics/plan';
import { trayBounds } from './camera';
import {
  clackStarts,
  coinHit,
  coinTaps,
  impacts,
  impactsOf,
  playClacks,
  playImpacts,
  rimContacts,
} from './sound';
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

/** (step, strength, body) triples of an impacts list. */
function triples(list: Float32Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < list.length; i += 3) {
    out.push([list[i] ?? NaN, list[i + 1] ?? NaN, list[i + 2] ?? NaN]);
  }
  return out;
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
    const found = triples(impacts([fall], 36));
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
    const found = triples(impacts([kicked(60, (k) => (k > 20 ? speed : 0))], 36));
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
    const found = triples(impacts([b], 36));
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
    const found = triples(impacts([kicked(60, (k) => (k > frame ? 5 : 0))], tail));
    expect(found.map((p) => p[0])).toEqual(steps);
  });

  it('reports the body of each impact, so a d6 and a coin are told apart', () => {
    // Body 0 is kicked at frame 30, body 1 at frame 20; the list is in step order.
    const d6 = kicked(60, (k) => (k > 30 ? 5 : 0));
    const coin = kicked(60, (k) => (k > 20 ? 8 : 0));
    const list = impacts([d6, coin], 0);
    expect(triples(list).map(([step, , b]) => [step, b])).toEqual([
      [20, 1],
      [30, 0],
    ]);
    expect(pairs(impactsOf(list, (b) => b === 0)).map((p) => p[0])).toEqual([30]);
    expect(pairs(impactsOf(list, (b) => b === 1)).map((p) => p[0])).toEqual([20]);
  });

  it('keeps the dice impact list of a fixed 3d6 plan as before bodies were reported', () => {
    const plan = planRoll(
      {
        v: 1,
        id: 'impacts',
        notation: '3d6',
        dice: [1, 2, 3].map((value) => ({ type: 'd6' as const, value, group: 0, wave: 0 })),
        modifier: 0,
        seed: '0123456789abcdef0123456789abcdef',
        createdAt: 0,
      },
      trayBounds(4 / 3, 2),
    );
    // Recorded from impacts() at 83fdaf3, which returned (step, strength) pairs.
    const before = [
      [23, 6.5515],
      [26, 8.4184],
      [36, 4.5923],
      [36, 4.6185],
      [42, 10.9003],
      [54, 5.2932],
      [57, 5.45],
      [57, 5.5178],
      [61, 2.2408],
      [75, 2.6788],
      [85, 2.1857],
      [92, 3.1582],
      [110, 2.9328],
      [118, 3.7908],
      [133, 2.7827],
    ];
    const found = pairs(impactsOf(impacts(plan.bodies, plan.tailSteps), () => true));
    expect(found).toHaveLength(before.length);
    found.forEach(([step, strength], i) => {
      expect(step).toBe(before[i]?.[0]);
      expect(strength).toBeCloseTo(before[i]?.[1] ?? NaN, 3);
    });
  });

  it('keeps the 48 strongest of 60 impacts in step order', () => {
    // Body i is kicked to i + 3 units/s at step 20 + 59 − i, so stronger bodies hit earlier.
    const bodies = Array.from({ length: 60 }, (_, i) =>
      kicked(120, (k) => (k > 79 - i ? i + 3 : 0)),
    );
    const found = triples(impacts(bodies, 36));
    expect(found.map((p) => p[0])).toEqual(Array.from({ length: 48 }, (_, j) => 20 + j));
    found.forEach(([, strength], j) => {
      expect(strength).toBeCloseTo(Math.sqrt((62 - j) ** 2 + 0.0625), 2);
    });
  });
});

/**
 * A coin on the floor whose tilt (degrees) about the horizontal axis at angle 2π·k/period turns
 * once per `period` frames; `lift` raises it off the floor.
 */
function wobbling(n: number, tilt: number, period: number, lift = 0) {
  const t = (tilt * Math.PI) / 360;
  // Rim radius √(0.65² − 0.1²) and half thickness 0.1: the lowest rim point touches y = 0.
  const y = Math.sqrt(0.65 ** 2 - 0.01) * Math.sin(2 * t) + 0.1 * Math.cos(2 * t) + lift;
  const frames = new Float32Array(n * 7);
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / period;
    const s = Math.sin(t);
    frames.set([0, y, 0, s * Math.cos(a), 0, s * Math.sin(a), Math.cos(t)], k * 7);
  }
  return { startStep: 100, frames };
}

describe('rimContacts', () => {
  it('finds 16 contacts per revolution of a coin wobbling at 5°, fading from 15 to 6, through the last frame', () => {
    // Two revolutions of 160 frames: the lowest of the 16 rim vertices changes every 10 frames,
    // at frames 5, 15, …, 315; the last ones would be missed if the tail's frames were skipped.
    const found = pairs(rimContacts(wobbling(320, 5, 160)));
    expect(found).toHaveLength(32);
    found.forEach(([step], j) => {
      expect(Math.abs(step - (105 + 10 * j))).toBeLessThanOrEqual(1);
    });
    expect(found[0]?.[1]).toBeCloseTo(15, 5);
    expect(found[31]?.[1]).toBeCloseTo(6, 5);
  });

  it.each([
    ['lying flat', wobbling(320, 0, 160)],
    ['tilted 1.5°, under the 2° threshold', wobbling(320, 1.5, 160)],
    ['0.05 above the floor', wobbling(320, 5, 160, 0.05)],
  ])('finds no contacts for a coin %s', (_, coin) => {
    expect(rimContacts(coin)).toHaveLength(0);
  });
});

describe('coinTaps', () => {
  it('caps rim contacts at 120 per roll, then taps each coin once at its last physical frame', () => {
    // 800 frames are 5 revolutions: 80 contacts per coin; the last physical frame is 800 − 36 − 1.
    const coin = { ...wobbling(800, 5, 160), shape: 'coin' as const };
    const d6 = { ...wobbling(800, 5, 160), shape: 'd6' as const };
    const found = pairs(coinTaps([coin, d6, { ...coin, startStep: 1000 }], 36));
    expect(found).toHaveLength(122);
    // Contacts fall within a step of 105 + 10j for the first coin and 1005 + 10j for the last.
    [
      [79, 895],
      [80, 1005],
      [119, 1395],
    ].forEach(([i = 0, step = 0]) => {
      expect(Math.abs((found[i]?.[0] ?? NaN) - step)).toBeLessThanOrEqual(1);
    });
    expect(found.slice(120)).toEqual([
      [863, 15],
      [1763, 15],
    ]);
  });
});

const SR = 48000;

/** Energy per Hann window (n samples, hop n/2) in [lo, hi) Hz by direct DFT. */
function bandEnergy(x: Float32Array, n: number, lo: number, hi: number): number[] {
  const cos = Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * i) / n));
  const sin = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * i) / n));
  const out: number[] = [];
  for (let at = 0; at + n <= x.length; at += n / 2) {
    const w = Array.from(
      { length: n },
      (_, i) => (x[at + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))),
    );
    let e = 0;
    for (let k = Math.max(1, Math.ceil((lo * n) / SR)); k < n / 2 && (k * SR) / n < hi; k++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        re += (w[i] ?? 0) * (cos[(k * i) % n] ?? 0);
        im -= (w[i] ?? 0) * (sin[(k * i) % n] ?? 0);
      }
      e += re * re + im * im;
    }
    out.push(e);
  }
  return out;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Time (s) of the last window of 4–8 kHz (the coin ring) within 20 dB of its loudest. */
function ringTime(x: Float32Array): number {
  const e = bandEnergy(x, 256, 4000, 8000);
  const peak = Math.max(...e);
  let last = 0;
  e.forEach((v, i) => {
    if (v > peak / 100) last = i;
  });
  return (last * 128) / SR;
}

describe('coinHit', () => {
  it.each([1, 2, 3, 4])(
    'puts ≥ 60% of a hit (seed %i) at 1–4 kHz and < 2% above 8 kHz, like a coin on wood',
    (seed) => {
      const hit = coinHit('hit', seed);
      // One window of silence first, so the half-covered first window does not cut the attack.
      const x = new Float32Array(2048 + hit.length);
      x.set(hit, 2048);
      const total = sum(bandEnergy(x, 2048, 0, SR / 2));
      expect(sum(bandEnergy(x, 2048, 1000, 4000)) / total).toBeGreaterThanOrEqual(0.6);
      expect(sum(bandEnergy(x, 2048, 8000, SR / 2)) / total).toBeLessThan(0.02);
    },
  );

  it.each([1, 2, 3, 4])('rings a rim contact (seed %i) under 0.6× as long as a hit', (seed) => {
    expect(ringTime(coinHit('rim', seed))).toBeLessThan(0.6 * ringTime(coinHit('hit', seed)));
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
