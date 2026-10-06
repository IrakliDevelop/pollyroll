import { createSeedRng } from '../core/rng';
import type { ShapeType } from '../geometry/polyhedra';
import { getBodyShape } from './body';
import { FLATTEN_STEPS, flattenTail, separate, upReadout } from './flatten';
import { throwWave } from './throw';
import { createWorld } from './world';
import type { TrayBounds } from './world';

export const MAX_STEPS_PER_WAVE = 720;
export const SETTLE_LINEAR = 0.05; // units/s
export const SETTLE_ANGULAR = 0.1; // rad/s
export const SETTLE_STEPS = 24;

export interface SimInput {
  seed: string;
  shapes: readonly ShapeType[];
  waves: readonly number[];
  bounds: TrayBounds;
}

export interface BodyTrack {
  shape: ShapeType;
  wave: number;
  startStep: number; // global step at which the body enters
  frames: Float32Array; // 7 floats per global step s = startStep..totalSteps inclusive (frame startStep = spawn state)
  upReadout: number; // readout index (geometry readouts) with max world y at the end; ties → lowest index
}

export interface SimResult {
  totalSteps: number;
  tracks: BodyTrack[];
  settled: boolean;
}

const FRAME = 7;
const LINEAR_SQ = SETTLE_LINEAR * SETTLE_LINEAR;
const ANGULAR_SQ = SETTLE_ANGULAR * SETTLE_ANGULAR;

/**
 * Runs the headless simulation for one roll. Waves are thrown in ascending order of their distinct
 * values (bodies keep input order within a wave), each after the previous one settles or reaches
 * MAX_STEPS_PER_WAVE steps; earlier dice stay in the world. A wave is settled once every body in the
 * world has stayed below SETTLE_LINEAR and SETTLE_ANGULAR for SETTLE_STEPS consecutive steps. Every
 * throw parameter comes from the sfc32 stream of `seed`. Tracks are returned in input order. Resting
 * centres are then pushed apart (see `separate`); when any die rests cocked or moved, every track
 * gains a FLATTEN_STEPS tail (see `flattenTail`); other dice hold.
 */
export function simulate(input: SimInput): SimResult {
  const { shapes, waves, bounds } = input;
  if (shapes.length !== waves.length) {
    throw new RangeError('shapes and waves must have the same length');
  }
  const rng = createSeedRng(input.seed);
  const world = createWorld(bounds);

  interface Body {
    shape: ShapeType;
    wave: number;
    startStep: number;
    frames: Float32Array; // grown by doubling, trimmed at the end
    length: number;
    index: number; // world body index
  }
  const bodies = shapes.map((shape, i): Body => ({
    shape,
    wave: waves[i] ?? 0,
    startStep: 0,
    frames: new Float32Array(FRAME * 256),
    length: 0,
    index: -1,
  }));
  const values: number[] = [];
  for (const w of waves) if (!values.includes(w)) values.push(w);
  values.sort((a, b) => a - b);

  const present: Body[] = []; // in world index order
  let totalSteps = 0;
  let settled = true;

  const record = (body: Body): void => {
    if (body.length + FRAME > body.frames.length) {
      const grown = new Float32Array(body.frames.length * 2);
      grown.set(body.frames);
      body.frames = grown;
    }
    world.read(body.index, body.frames, body.length);
    body.length += FRAME;
  };

  for (const wave of values) {
    const members = bodies.filter((b) => b.wave === wave);
    const states = throwWave(
      rng,
      members.map((b) => getBodyShape(b.shape).radius),
      bounds,
    );
    states.forEach((s, k) => {
      const body = members[k];
      if (body === undefined) return;
      body.index = world.add(body.shape, s.position, s.orientation, s.velocity, s.angularVelocity);
      body.startStep = totalSteps;
      present.push(body);
      record(body);
    });
    let calm = 0;
    let steps = 0;
    while (calm < SETTLE_STEPS && steps < MAX_STEPS_PER_WAVE) {
      world.step();
      steps++;
      totalSteps++;
      let still = true;
      for (const body of present) {
        record(body);
        if (
          world.linearSpeedSq(body.index) >= LINEAR_SQ ||
          world.angularSpeedSq(body.index) >= ANGULAR_SQ
        ) {
          still = false;
        }
      }
      calm = still ? calm + 1 : 0;
    }
    if (calm < SETTLE_STEPS) settled = false;
  }

  const poses = bodies.map((body) => {
    const pose = new Float64Array(FRAME);
    if (body.index >= 0) world.read(body.index, pose, 0);
    return pose;
  });
  const xz = new Float64Array(poses.flatMap((p) => [p[0] ?? 0, p[2] ?? 0]));
  separate(
    xz,
    bodies.map((b) => getBodyShape(b.shape).radius),
    bounds,
  );
  const ends = bodies.map((body, i) => {
    const pose = poses[i];
    if (body.index < 0 || pose === undefined) return { up: 0, tail: null };
    const tail = flattenTail(body.shape, pose, xz[2 * i] ?? 0, xz[2 * i + 1] ?? 0);
    return { up: upReadout(body.shape, pose), tail };
  });
  const extra = ends.some((e) => e.tail !== null) ? FLATTEN_STEPS : 0;
  const tracks = bodies.map((body, i): BodyTrack => {
    const frames = new Float32Array(body.length + extra * FRAME);
    frames.set(body.frames.subarray(0, body.length));
    const tail = ends[i]?.tail;
    for (let k = 0; k < extra; k++) {
      const at = body.length + k * FRAME;
      if (tail) frames.set(tail.subarray(k * FRAME, (k + 1) * FRAME), at);
      else frames.copyWithin(at, body.length - FRAME, body.length);
    }
    return {
      shape: body.shape,
      wave: body.wave,
      startStep: body.startStep,
      frames,
      upReadout: ends[i]?.up ?? 0,
    };
  });
  return { totalSteps: totalSteps + extra, tracks, settled };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32-bit step over one byte. */
function fnvByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
}

/** FNV-1a 32-bit over every track's Float32 frames, read as uint32 words (Uint32Array view), each word
 *  fed least-significant byte first, tracks in order. Returns 8 lowercase hex chars. */
export function trackHash(result: SimResult): string {
  let hash = FNV_OFFSET;
  for (const track of result.tracks) {
    const f = track.frames;
    const words = new Uint32Array(f.buffer, f.byteOffset, f.length);
    for (const word of words) {
      hash = fnvByte(hash, word & 0xff);
      hash = fnvByte(hash, (word >>> 8) & 0xff);
      hash = fnvByte(hash, (word >>> 16) & 0xff);
      hash = fnvByte(hash, word >>> 24);
    }
  }
  return hash.toString(16).padStart(8, '0');
}
