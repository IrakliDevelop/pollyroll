import { getPolyhedron } from '../geometry/polyhedra';
import type { PlannedBody } from '../physics/plan';
import { DEFAULT_CONFIG, DT } from '../physics/world';

/** Recorded clacks: base64 audio plus [start ms after its first sound, length ms] per clack. */
export interface ClackSet {
  readonly audio: string;
  readonly clacks: readonly (readonly [number, number])[];
}

const MIN_STRENGTH = 2; // units/s
const COOLDOWN = 6; // steps between two impacts of one body
const MAX_IMPACTS = 48;
const FULL_STRENGTH = 15; // units/s at full volume
const G_DT = DEFAULT_CONFIG.gravity * DT;
const MAX_RIMS = 120;
const COS_2DEG = Math.cos(Math.PI / 90);
const STILL = 0.05 * DT; // units per frame
const SR = 48000;
const db = (d: number): number => 10 ** (d / 20);
const PITCH = 4900; // Hz
const RING = 0.06; // s
const SPLIT = 0.022;
const KNOCK = 1200; // Hz
const CONTACT = 3000; // Hz
const TABLE_RING = 0.012; // s
const RIM_RING = 0.45;
// Ring mode ratios and levels fitted to Kenney's coin clinks; table modes to coins dropped on wood.
const RATIOS = [1, 1.73, 2.72, 3.57];
const LEVELS = [1, 0.55, 0.35, 0.2];
const TABLE = [610, 980, 1240, 1600, 1750, 2060, 2340];
const LEVEL = 0.3; // a full hit peaks near 1
/** Gain of a recorded clink per unit volume: −4 dB under the synth hit, as in the lab's blend. */
export const CLINK = LEVEL * db(-4);

/**
 * Impact list of a roll as (global step, strength, body index) triples in step order, keeping the
 * strongest 48. Impulse proxy: second difference of the keyframe positions minus gravity.
 */
export function impacts(
  bodies: readonly Pick<PlannedBody, 'startStep' | 'frames'>[],
  tailSteps: number,
): Float32Array {
  const all: [number, number, number][] = [];
  for (const [b, { startStep, frames: f }] of bodies.entries()) {
    const v = (k: number, i: number): number =>
      ((f[k * 7 + i] ?? 0) - (f[k * 7 - 7 + i] ?? 0)) / DT;
    // The settle-to-flat tail is interpolated, not physical.
    const end = f.length / 7 - tailSteps - 1;
    let last = -COOLDOWN;
    for (let k = 1; k < end; k++) {
      const x = v(k + 1, 0) - v(k, 0);
      const y = v(k + 1, 1) - v(k, 1) - G_DT;
      const z = v(k + 1, 2) - v(k, 2);
      const strength = Math.sqrt(x * x + y * y + z * z);
      if (strength < MIN_STRENGTH || k - last < COOLDOWN) continue;
      last = k;
      all.push([startStep + k, strength, b]);
    }
  }
  all.sort((a, b) => a[0] - b[0]);
  const keep = all
    .map((_, i) => i)
    .sort((a, b) => (all[b]?.[1] ?? 0) - (all[a]?.[1] ?? 0) || a - b)
    .slice(0, MAX_IMPACTS)
    .sort((a, b) => a - b);
  return new Float32Array(keep.flatMap((i) => all[i] ?? []));
}

/** The (step, strength) pairs of the impacts whose body index passes `keep`. */
export function impactsOf(list: Float32Array, keep: (body: number) => boolean): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < list.length; i += 3) {
    if (keep(list[i + 2] ?? -1)) out.push(list[i] ?? 0, list[i + 1] ?? 0);
  }
  return new Float32Array(out);
}

/**
 * Rim contacts of a wobbling coin as (global step, strength) pairs over every frame: one per change
 * of its lowest hull vertex while it is tilted over 2° within 0.02 of the floor. Strength fades
 * from full (15) to 40% over the wobble.
 */
export function rimContacts(body: Pick<PlannedBody, 'startStep' | 'frames'>): Float32Array {
  const { vertices } = getPolyhedron('coin');
  const f = body.frames;
  const steps: number[] = [];
  let last = -1;
  for (let k = 0; k < f.length / 7; k++) {
    const x = f[k * 7 + 3] ?? 0;
    const y = f[k * 7 + 4] ?? 0;
    const z = f[k * 7 + 5] ?? 0;
    const w = f[k * 7 + 6] ?? 1;
    // The y row of the rotation matrix gives each vertex's height without a rotated copy.
    const a = 2 * (x * y + w * z);
    const b = 1 - 2 * (x * x + z * z);
    const c = 2 * (y * z - w * x);
    let low = -1;
    let h = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      const vh = a * (v?.[0] ?? 0) + b * (v?.[1] ?? 0) + c * (v?.[2] ?? 0);
      if (vh < h) {
        low = i;
        h = vh;
      }
    }
    if (flatAt(f, k) || (f[k * 7 + 1] ?? 0) + h > 0.02) {
      last = -1;
      continue;
    }
    if (last >= 0 && low !== last) steps.push(body.startStep + k);
    last = low;
  }
  const fade = 0.6 / Math.max(1, steps.length - 1);
  return new Float32Array(steps.flatMap((s, j) => [s, FULL_STRENGTH * (1 - fade * j)]));
}

/** Whether frame k's cap normal is within 2° of vertical. */
function flatAt(f: Float32Array, k: number): boolean {
  const x = f[k * 7 + 3] ?? 0;
  const z = f[k * 7 + 5] ?? 0;
  return Math.abs(1 - 2 * (x * x + z * z)) > COS_2DEG;
}

/**
 * Rim contacts of every coin, the first 120 per roll by time, and one soft tap per coin at the
 * frame from which it stays flat and still through its physical frames (the tail's end if never),
 * always before the settle step.
 */
export function coinTaps(
  bodies: readonly Pick<PlannedBody, 'shape' | 'startStep' | 'frames'>[],
  tailSteps: number,
): { rims: Float32Array; taps: Float32Array } {
  const coins = bodies.filter((b) => b.shape === 'coin');
  const all = coins.flatMap((b) => {
    const r = rimContacts(b);
    return Array.from({ length: r.length / 2 }, (_, j) => [r[j * 2] ?? 0, r[j * 2 + 1] ?? 0]);
  });
  // A stable sort keeps body order within a step.
  all.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  const taps = coins.flatMap(({ startStep, frames: f }) => {
    const n = f.length / 7;
    let k = n - tailSteps - 1;
    if (!flatAt(f, k)) k = n - 1;
    else while (k > 0 && flatAt(f, k - 1) && moved(f, k) < STILL * STILL) k--;
    return [startStep + Math.min(k, n - 2), FULL_STRENGTH];
  });
  return { rims: new Float32Array(all.slice(0, MAX_RIMS).flat()), taps: new Float32Array(taps) };
}

/** Squared position change from frame k − 1 to frame k. */
function moved(f: Float32Array, k: number): number {
  let d = 0;
  for (let i = 0; i < 3; i++) d += ((f[k * 7 + i] ?? 0) - (f[k * 7 - 7 + i] ?? 0)) ** 2;
  return d;
}

/** Adds a damped sine to `out` by the two-term resonator recursion, so there is no sin per sample. */
function ring(out: Float32Array, f: number, amp: number, tau: number, ph: number): void {
  const w = (2 * Math.PI * f) / SR;
  const d = Math.exp(-1 / (tau * SR));
  const c1 = 2 * d * Math.cos(w);
  const n = Math.min(Math.round(5 * tau * SR), out.length);
  let y1 = Math.sin(ph - w) / d;
  let y2 = Math.sin(ph - 2 * w) / (d * d);
  for (let i = 0; i < n; i++) {
    const y = c1 * y1 - d * d * y2;
    y2 = y1;
    y1 = y;
    out[i] = (out[i] ?? 0) + amp * Math.min(1, i / (0.0003 * SR)) * y;
  }
}

// Wood keeps the coin in contact for longer, so a strike excites little above 1/(contact time).
const excite = (f: number): number => 1 / Math.sqrt(1 + (f / CONTACT) ** 4);

/**
 * A coin striking a wooden table at 48 kHz, by modal synthesis: the coin's ring modes as split
 * doublets of damped sines rolled off above the contact frequency, the table's modes, and an RBJ
 * band-passed noise click. A `rim` contact is 12 dB softer with a 0.45× ring.
 */
export function coinHit(kind: 'hit' | 'rim', seed: number): Float32Array {
  let state = seed;
  const r = (): number => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  const s = kind === 'hit' ? 1 : db(-12);
  const ringS = kind === 'hit' ? RING : RING * RIM_RING;
  const out = new Float32Array(Math.round(5 * ringS * SR));
  RATIOS.forEach((ratio, k) => {
    const f = PITCH * ratio;
    const amp = (LEVELS[k] ?? 0) * s ** (1 + 0.25 * k) * excite(f);
    for (const side of [-1, 1]) {
      ring(out, f * (1 + (side * SPLIT) / 2), amp / 2, ringS / ratio ** 0.8, 2 * Math.PI * r());
    }
  });
  for (const f of TABLE) {
    ring(
      out,
      f * (0.98 + 0.04 * r()),
      s * (0.3 + 0.7 * r()) * excite(f),
      TABLE_RING,
      2 * Math.PI * r(),
    );
  }
  const w0 = (2 * Math.PI * KNOCK) / SR;
  const al = Math.sin(w0) / 3; // Q 1.5
  const b0 = al / (1 + al);
  const a1 = (-2 * Math.cos(w0)) / (1 + al);
  const a2 = (1 - al) / (1 + al);
  const decay = Math.exp(-1 / (0.0025 * SR));
  const g = 3 * s * db(-12);
  let [x1, x2, y1, y2, env] = [0, 0, 0, 0, 1];
  for (let i = 0; i < 0.02 * SR; i++) {
    const x = (r() * 2 - 1) * env;
    env *= decay;
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, x, y1, y];
    out[i] = (out[i] ?? 0) + g * y;
  }
  return out.map((v) => v * LEVEL);
}

/** Clips in one buffer: clip k starts at `starts[k]` s and lasts `clacks[k][1]` ms. */
export interface Clips extends Pick<ClackSet, 'clacks'> {
  readonly buffer: AudioBuffer;
  readonly starts: readonly number[];
}

/** The coin synth's 4 `hit` and 4 `rim` strikes (fixed seeds), each set in one buffer as clips for playClacks. */
export function coinBank(ctx: AudioContext): Record<'hit' | 'rim', Clips> {
  const clips = (kind: 'hit' | 'rim'): Clips => {
    const parts = [1, 2, 3, 4].map((seed) => coinHit(kind, seed));
    const n = parts[0]?.length ?? 0;
    const buffer = ctx.createBuffer(1, 4 * n, SR);
    const data = buffer.getChannelData(0);
    parts.forEach((p, i) => data.set(p, i * n));
    return {
      buffer,
      starts: parts.map((_, i) => (i * n) / SR),
      clacks: parts.map(() => [0, (n / SR) * 1000]),
    };
  };
  return { hit: clips('hit'), rim: clips('rim') };
}

/** 60 ms of mono white noise with an exponential decay baked in. */
export function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.round(rate * 0.06), rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (rate * 0.01));
  }
  return buffer;
}

/** Schedules a band-passed `noise` burst per impact at `start + step · DT / rate`, skipping past ones; returns them. */
export function playImpacts(
  ctx: AudioContext,
  noise: AudioBuffer,
  list: Float32Array,
  start: number,
  volume: number,
  rate: number,
): AudioBufferSourceNode[] {
  const sources: AudioBufferSourceNode[] = [];
  for (let i = 0; i < list.length / 2; i++) {
    const when = start + ((list[i * 2] ?? 0) * DT) / rate;
    if (when < ctx.currentTime) continue;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800 + ((i * 5) % 8) * 200;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = volume * Math.min(1, (list[i * 2 + 1] ?? 0) / FULL_STRENGTH);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(when);
    sources.push(src);
  }
  return sources;
}

/** Clack starts (s) from the first sample at 20% of peak, above MP3 pre-echo: decoders differ in trimming the encoder delay. */
export function clackStarts(data: Float32Array, sampleRate: number, set: ClackSet): number[] {
  let peak = 0;
  for (const x of data) peak = Math.max(peak, Math.abs(x));
  const anchor = data.findIndex((x) => Math.abs(x) > 0.2 * peak) / sampleRate;
  return set.clacks.map(([ms]) => Math.max(0, anchor + ms / 1000));
}

/** Schedules one recorded clack per impact at `start + step · DT / rate`, skipping past ones; returns them. */
export function playClacks(
  ctx: AudioContext,
  buffer: AudioBuffer,
  starts: readonly number[],
  set: Pick<ClackSet, 'clacks'>,
  list: Float32Array,
  start: number,
  volume: number,
  rate: number,
): AudioBufferSourceNode[] {
  const sources: AudioBufferSourceNode[] = [];
  for (let i = 0; i < list.length / 2; i++) {
    const when = start + ((list[i * 2] ?? 0) * DT) / rate;
    if (when < ctx.currentTime) continue;
    const k = (i * 5 + 1) % set.clacks.length;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 0.94 + (0.12 * ((i * 7) % 13)) / 12;
    const gain = ctx.createGain();
    gain.gain.value = volume * Math.min(1, (list[i * 2 + 1] ?? 0) / FULL_STRENGTH);
    src.connect(gain).connect(ctx.destination);
    src.start(when, starts[k] ?? 0, (set.clacks[k]?.[1] ?? 0) / 1000);
    sources.push(src);
  }
  return sources;
}
