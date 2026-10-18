import { MAX_WAVE, dieRange, fires } from './dice';
import { isAudience, isId, isSkin } from './event';
import { parse } from './notation';
import { cryptoInt, generateId, generateSeed, isSeed } from './rng';
import type { CreateRollOptions, DiceTerm, RollEvent, RolledDie } from './types';

export function createRoll(notation: string, opts: CreateRollOptions = {}): RollEvent {
  const ast = parse(notation);
  const rng = opts.rng ?? cryptoInt;
  const seed = opts.seed ?? generateSeed();
  if (!isSeed(seed)) throw new TypeError('seed must be 32 lowercase hex characters');
  const { skin, rollerId, audience } = opts;
  if (rollerId !== undefined && !isId(rollerId)) throw new RangeError('invalid rollerId');
  if (audience !== undefined && !isAudience(audience)) throw new RangeError('invalid audience');
  // Custom GLSL never passes isRollEvent but stays allowed for local rolls.
  const glsl = typeof skin === 'object' && typeof skin.pattern === 'object';
  if (skin !== undefined && !glsl && !isSkin(skin)) throw new RangeError('invalid skin');

  const terms: DiceTerm[] = [];
  let modifier = 0;
  for (const term of ast.terms) {
    if (term.kind === 'dice') terms.push(term);
    else modifier += term.sign * term.value;
  }

  // Dice of the current wave that explode or reroll, in array order: [term, group].
  type Spawn = [DiceTerm, number];
  const dice: RolledDie[] = [];
  const roll = (term: DiceTerm, group: number, wave: number, next: Spawn[]): void => {
    const [min, max] = dieRange(term.die);
    const size = max - min + 1;
    const r = rng(size);
    if (!Number.isInteger(r) || r < 0 || r >= size) {
      throw new RangeError(`rng must return an integer in [0, ${size}), got ${r}`);
    }
    const value = r + min;
    dice.push({ type: term.die, value, group, wave });
    if (fires(term, value, wave)) next.push([term, group]);
  };
  let pending: Spawn[] = [];
  terms.forEach((term, group) => {
    for (let i = 0; i < term.count; i++) roll(term, group, 0, pending);
  });
  for (let wave = 1; wave <= MAX_WAVE && pending.length > 0; wave++) {
    const next: Spawn[] = [];
    for (const [term, group] of pending) roll(term, group, wave, next);
    pending = next;
  }

  const event: RollEvent = {
    v: 1,
    id: generateId(),
    notation,
    dice,
    modifier,
    seed,
    createdAt: Date.now(),
  };
  if (skin !== undefined) event.skin = skin;
  if (rollerId !== undefined) event.rollerId = rollerId;
  if (audience !== undefined) event.audience = audience;
  return event;
}
