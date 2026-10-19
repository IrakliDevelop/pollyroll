import type { PlannedBody } from '../physics/plan';
import { DEFAULT_CONFIG, DT } from '../physics/world';

const MIN_STRENGTH = 2; // units/s
const COOLDOWN = 6; // steps between two impacts of one body
const MAX_IMPACTS = 48;
const FULL_STRENGTH = 15; // units/s at full volume
const G_DT = DEFAULT_CONFIG.gravity * DT;

/**
 * Impact list of a roll as (global step, strength) pairs in step order, keeping the strongest 48.
 * Impulse proxy: second difference of the keyframe positions minus gravity.
 */
export function impacts(
  bodies: readonly Pick<PlannedBody, 'startStep' | 'frames'>[],
  tailSteps: number,
): Float32Array {
  const all: [number, number][] = [];
  for (const { startStep, frames: f } of bodies) {
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
      all.push([startStep + k, strength]);
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

/** Schedules a band-passed `noise` burst per impact at `start + step · DT / rate`; returns them. */
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
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800 + ((i * 5) % 8) * 200;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = volume * Math.min(1, (list[i * 2 + 1] ?? 0) / FULL_STRENGTH);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(start + ((list[i * 2] ?? 0) * DT) / rate);
    sources.push(src);
  }
  return sources;
}
