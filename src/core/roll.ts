import { MAX_WAVE, dieRange, fires } from './dice';
import { isAudience, isId, isInt, isSkin, optional } from './event';
import { parse } from './notation';
import { cryptoInt, generateId, generateSeed, isSeed } from './rng';
import type { CreateRollOptions, DiceTerm, RollEvent, RolledDie } from './types';

export function createRoll(notation: string, opts: CreateRollOptions = {}): RollEvent {
  const ast = parse(notation);
  const rng = opts.rng ?? cryptoInt;
  const seed = opts.seed ?? generateSeed();
  if (!isSeed(seed)) throw new TypeError('seed must be 32 lowercase hex characters');
  const { skin, rollerId, audience } = opts;
  if (!optional(rollerId, isId)) throw new RangeError('invalid rollerId');
  if (!optional(audience, isAudience)) throw new RangeError('invalid audience');
  // Custom GLSL never passes isRollEvent but stays allowed for local rolls.
  const glsl = typeof skin === 'object' && typeof skin.pattern === 'object';
  if (!glsl && !optional(skin, isSkin)) throw new RangeError('invalid skin');

  const terms: DiceTerm[] = [];
  let modifier = 0;
  for (const term of ast.terms) {
    if (term.kind === 'dice') terms.push(term);
    else modifier += term.sign * term.value;
  }

  const dice: RolledDie[] = [];
  // Dice to roll in the current wave, in array order: [term, group].
  let pending = terms.flatMap((term, group) =>
    Array<[DiceTerm, number]>(term.count).fill([term, group]),
  );
  for (let wave = 0; wave <= MAX_WAVE && pending.length > 0; wave++) {
    const next: typeof pending = [];
    for (const spawn of pending) {
      const [term, group] = spawn;
      const [min, max] = dieRange(term.die);
      const size = max - min + 1;
      const r = rng(size);
      if (!isInt(r, 0, size - 1)) {
        throw new RangeError(`rng must return an integer in [0, ${size}), got ${r}`);
      }
      const value = r + min;
      dice.push({ type: term.die, value, group, wave });
      if (fires(term, value, wave)) next.push(spawn);
    }
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
