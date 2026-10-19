import type { RollEvent, RollSummary } from '../core/types';
import type { RollPlan } from '../physics/plan';

/** Step from which each dropped die draws faded: a rerolled die when its replacement wave
 *  starts, any other dropped die at settle (plan.totalSteps). */
export function fadeSteps(
  event: RollEvent,
  summary: RollSummary,
  plan: RollPlan,
): Map<number, number> {
  const out = new Map<number, number>();
  // Summary indices are group-local: die i is the k-th die of its group.
  const seen: number[] = [];
  event.dice.forEach((d, i) => {
    const k = seen[d.group] ?? 0;
    seen[d.group] = k + 1;
    const group = summary.groups[d.group];
    if (!group?.dropped.includes(k)) return;
    if (!group.rerolled.includes(k)) {
      out.set(i, plan.totalSteps);
      return;
    }
    const next = plan.bodies.find(
      (b) => b.wave === d.wave + 1 && event.dice[b.die]?.group === d.group,
    );
    out.set(i, next?.startStep ?? plan.totalSteps);
  });
  return out;
}
