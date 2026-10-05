import type { RollEvent } from '../core/types';
import { readoutForValue, shapeOf } from '../geometry/labels';
import type { LabelSet } from '../geometry/labels';
import type { ShapeType } from '../geometry/polyhedra';
import { findRemap } from '../geometry/symmetry';
import { IDENTITY } from '../geometry/vec';
import type { Quat } from '../geometry/vec';
import { simulate, trackHash } from './sim';
import type { TrayBounds } from './world';

export const MAX_BODIES = 30;

export interface PlannedBody {
  die: number; // index into event.dice
  labelSet: LabelSet;
  shape: ShapeType;
  wave: number;
  startStep: number;
  frames: Float32Array; // from the BodyTrack (unmodified)
  remap: Quat; // S: render orientation = q(t) ⊗ S; IDENTITY when value is null
  upReadout: number; // settled up readout before remap
  value: number | null; // value shown by THIS body (d100 part), null = blank labels
}

export interface RollPlan {
  totalSteps: number;
  settled: boolean;
  hash: string;
  bodies: PlannedBody[];
}

interface Slot {
  die: number;
  labelSet: LabelSet;
  wave: number;
  value: number | null;
}

/** Bodies for the event's dice in order: d100 → tens then ones d10, dF → d6. Stops at the first die
 *  that no longer fits in MAX_BODIES. */
function slots(event: RollEvent): Slot[] {
  const out: Slot[] = [];
  for (let i = 0; i < event.dice.length; i++) {
    const d = event.dice[i];
    if (d === undefined) break;
    const { type, value, wave } = d;
    if (type === 'd100') {
      if (out.length + 2 > MAX_BODIES) break;
      let tens: number | null = null;
      let ones: number | null = null;
      if (value !== null) {
        ones = value % 10;
        tens = value === 100 ? 0 : (value - ones) / 10;
      }
      out.push({ die: i, labelSet: 'd100tens', wave, value: tens });
      out.push({ die: i, labelSet: 'd100ones', wave, value: ones });
    } else {
      if (out.length + 1 > MAX_BODIES) break;
      out.push({ die: i, labelSet: type, wave, value });
    }
  }
  return out;
}

/**
 * Result-first roll plan: simulates the event's dice headless from `event.seed`, then picks for each
 * body the rotation symmetry S that carries the face showing its value onto the settled up-face, so
 * rendering q(t) ⊗ S keeps the motion and shows the value. Redacted dice keep IDENTITY.
 */
export function planRoll(event: RollEvent, bounds: TrayBounds): RollPlan {
  const list = slots(event);
  const shapes = list.map((s) => shapeOf(s.labelSet));
  const result = simulate({ seed: event.seed, shapes, waves: list.map((s) => s.wave), bounds });
  const bodies = list.map((slot, k): PlannedBody => {
    const track = result.tracks[k];
    if (track === undefined) throw new Error(`missing track ${k}`);
    const remap =
      slot.value === null
        ? IDENTITY
        : findRemap(track.shape, readoutForValue(slot.labelSet, slot.value), track.upReadout);
    return {
      die: slot.die,
      labelSet: slot.labelSet,
      shape: track.shape,
      wave: track.wave,
      startStep: track.startStep,
      frames: track.frames,
      remap,
      upReadout: track.upReadout,
      value: slot.value,
    };
  });
  return {
    totalSteps: result.totalSteps,
    settled: result.settled,
    hash: trackHash(result),
    bodies,
  };
}
