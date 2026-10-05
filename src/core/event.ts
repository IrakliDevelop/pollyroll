import { MAX_WAVE, dieRange } from './dice';
import { parse } from './notation';
import { isSeed } from './rng';
import type { DiceTerm, RollEvent } from './types';

const MAX_EVENT_DICE = 2200;

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown, min: number, max: number): boolean =>
  typeof x === 'string' && x.length >= min && x.length <= max;
const isInt = (x: unknown, min: number, max: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const isUnit = (x: unknown): boolean => typeof x === 'number' && x >= 0 && x <= 1;
const oneOf = (x: unknown, words: string): boolean =>
  typeof x === 'string' && words.split(' ').includes(x);
const optional = (x: unknown, test: (x: unknown) => boolean): boolean => x === undefined || test(x);
/** Like `every`, but visits holes in sparse arrays: the iterator yields them as `undefined`. */
const all = (list: unknown[], test: (x: unknown) => boolean): boolean => {
  for (const x of list) if (!test(x)) return false;
  return true;
};

const isColor = (x: unknown): boolean => isStr(x, 0, 64);

const isMaterial = (m: unknown): boolean =>
  isObj(m)
    ? isUnit(m.metalness) && isUnit(m.roughness) && optional(m.clearcoat, isUnit)
    : oneOf(m, 'plastic metal wood glass stone gem');

/** Skin reference from untrusted input; inline GLSL patterns are rejected. */
const isSkin = (s: unknown): boolean =>
  isObj(s)
    ? isMaterial(s.material) &&
      (Array.isArray(s.color) ? s.color.length === 2 && all(s.color, isColor) : isColor(s.color)) &&
      isColor(s.labelColor) &&
      optional(s.labelStyle, (x) => oneOf(x, 'engraved printed embossed')) &&
      optional(s.pattern, (x) => oneOf(x, 'none gradient speckle marble wood swirl')) &&
      optional(s.font, (x) => isStr(x, 1, 128))
    : isStr(s, 1, 64);

const isId = (x: unknown): boolean => isStr(x, 1, 128);

const isAudience = (a: unknown): boolean =>
  Array.isArray(a) ? a.length <= 100 && all(a, isId) : oneOf(a, 'all dm');

/**
 * Copy of `event` with every value set to null and explosion dice (wave ≥ 1) removed, so the
 * number of dice reveals nothing about the hidden values.
 */
export function redact(event: RollEvent): RollEvent {
  const dice = event.dice.filter((die) => die.wave === 0).map((die) => ({ ...die, value: null }));
  const copy: RollEvent = { ...event, dice };
  const { audience, skin } = event;
  if (Array.isArray(audience)) copy.audience = audience.slice();
  if (typeof skin === 'object') {
    const { color } = skin;
    copy.skin = { ...skin, color: typeof color === 'string' ? color : [color[0], color[1]] };
  }
  return copy;
}

function check(e: unknown): boolean {
  if (
    !isObj(e) ||
    e.v !== 1 ||
    !isId(e.id) ||
    typeof e.notation !== 'string' ||
    !isSeed(e.seed) ||
    typeof e.createdAt !== 'number' ||
    !(e.createdAt >= 0 && e.createdAt < Infinity) ||
    !optional(e.skin, isSkin) ||
    !optional(e.rollerId, isId) ||
    !optional(e.audience, isAudience)
  ) {
    return false;
  }

  const terms: DiceTerm[] = [];
  let modifier = 0;
  for (const t of parse(e.notation).terms) {
    if (t.kind === 'dice') terms.push(t);
    else modifier += t.sign * t.value;
  }
  const dice = e.dice;
  if (
    e.modifier !== modifier ||
    !Array.isArray(dice) ||
    dice.length < 1 ||
    dice.length > MAX_EVENT_DICE
  ) {
    return false;
  }

  // Per group g and wave w at index g * W + w: dice count and dice showing the max value.
  const W = MAX_WAVE + 1;
  const count: number[] = new Array<number>(terms.length * W).fill(0);
  const maxed = count.slice();
  const hidden = terms.map(() => false);
  const get = (list: number[], i: number): number => list[i] ?? 0;
  let lastWave = 0;
  for (const die of dice as unknown[]) {
    if (!isObj(die)) return false;
    const { type, group, wave, value } = die;
    if (!isInt(group, 0, terms.length - 1)) return false;
    const term = terms[group];
    if (!term || term.die !== type || !isInt(wave, lastWave, term.explode ? MAX_WAVE : 0)) {
      return false;
    }
    lastWave = wave;
    const [min, max] = dieRange(term.die);
    if (value === null) hidden[group] = true;
    else if (!isInt(value, min, max)) return false;
    const k = group * W + wave;
    count[k] = get(count, k) + 1;
    if (value === max) maxed[k] = get(maxed, k) + 1;
  }

  return terms.every((term, g) => {
    const at = (list: number[], w: number): number => get(list, g * W + w);
    if (at(count, 0) !== term.count) return false;
    // Non-exploding terms were already limited to wave 0 above.
    for (let w = 1; term.explode && w <= MAX_WAVE; w++) {
      const limit = hidden[g] ? at(count, w - 1) : at(maxed, w - 1);
      if (hidden[g] ? at(count, w) > limit : at(count, w) !== limit) return false;
    }
    return true;
  });
}

/** True when `input` is a structurally valid v1 `RollEvent`. Never throws. */
export function isRollEvent(input: unknown): input is RollEvent {
  try {
    return check(input);
  } catch {
    return false;
  }
}
