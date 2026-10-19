import { describe, expect, it } from 'vitest';
import { evaluate } from '../core/evaluate';
import type { RolledDie, RollEvent } from '../core/types';
import { planRoll } from '../physics/plan';
import type { RollPlan } from '../physics/plan';
import { trayBounds } from './camera';
import { fadeSteps } from './fade';

const SEED = '0123456789abcdef0123456789abcdef';

function event(notation: string, waves: number[][]): RollEvent {
  const dice: RolledDie[] = waves.flatMap((values, wave) =>
    values.map((value) => ({ type: 'd6', value, group: 0, wave })),
  );
  return { v: 1, id: 't', notation, dice, modifier: 0, seed: SEED, createdAt: 0 };
}

function setup(e: RollEvent): { plan: RollPlan; fade: Map<number, number> } {
  const plan = planRoll(e, trayBounds(4 / 3, 1));
  return { plan, fade: fadeSteps(e, evaluate(e), plan) };
}

function startOf(plan: RollPlan, die: number): number {
  const body = plan.bodies.find((b) => b.die === die);
  if (body === undefined) throw new Error(`die ${die} not planned`);
  return body.startStep;
}

describe('fadeSteps', () => {
  it('fades a rerolled die when its replacement starts and a keep/drop die at settle', () => {
    const { plan, fade } = setup(event('4d6r1kh3', [[1, 4, 5, 6], [3]]));
    const replacement = startOf(plan, 4);
    expect(fade).toEqual(
      new Map([
        [0, replacement],
        [4, plan.totalSteps],
      ]),
    );
    expect(replacement).toBeGreaterThan(0);
    expect(replacement).toBeLessThan(plan.totalSteps);
  });

  it('fades each die of a reroll chain when its own replacement wave starts', () => {
    const { plan, fade } = setup(event('1d6r1', [[1], [1], [5]]));
    const wave1 = startOf(plan, 1);
    const wave2 = startOf(plan, 2);
    expect(fade).toEqual(
      new Map([
        [0, wave1],
        [1, wave2],
      ]),
    );
    expect(wave1).toBeLessThan(wave2);
  });

  it('fades nothing when no die is dropped', () => {
    expect(setup(event('2d6', [[3, 5]])).fade).toEqual(new Map());
  });

  it('fades a rerolled die at settle when its replacement is beyond the animated bodies', () => {
    const first = [1, ...Array.from({ length: 29 }, (_, i) => 2 + (i % 5))];
    const { plan, fade } = setup(event('30d6r1', [first, [4]]));
    expect(plan.bodies).toHaveLength(30);
    expect(fade).toEqual(new Map([[0, plan.totalSteps]]));
  });
});
