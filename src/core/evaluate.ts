import { parse } from './notation';
import type { DiceTerm, RollEvent, RollGroupSummary, RollSummary } from './types';

const ascending = (list: [number, number][]): number[] =>
  list.map(([, i]) => i).sort((a, b) => a - b);

export function evaluate(event: RollEvent): RollSummary {
  const buckets = parse(event.notation)
    .terms.filter((t): t is DiceTerm => t.kind === 'dice')
    .map((term) => ({ term, dice: [] as (number | null)[] }));
  for (const die of event.dice) {
    const bucket = buckets[die.group];
    if (!bucket) throw new TypeError(`die group ${die.group} is out of range`);
    bucket.dice.push(die.value);
  }

  let total: number | null = event.modifier;
  const groups = buckets.map(({ term, dice }): RollGroupSummary => {
    const pairs: [number, number][] = [];
    dice.forEach((v, i) => {
      if (v !== null) pairs.push([v, i]);
    });
    if (pairs.length < dice.length) {
      total = null;
      return { die: term.die, dice, kept: [], dropped: [], subtotal: null };
    }
    let keep = pairs;
    let drop: [number, number][] = [];
    if (term.keep) {
      const { mode, n } = term.keep;
      const dir = mode === 'kh' || mode === 'dh' ? -1 : 1;
      const ranked = pairs.slice().sort(([va, a], [vb, b]) => dir * (va - vb) || a - b);
      [keep, drop] =
        mode[0] === 'k'
          ? [ranked.slice(0, n), ranked.slice(n)]
          : [ranked.slice(n), ranked.slice(0, n)];
    }
    let subtotal = 0;
    for (const [v] of keep) subtotal += term.sign * v;
    if (total !== null) total += subtotal;
    return { die: term.die, dice, kept: ascending(keep), dropped: ascending(drop), subtotal };
  });

  return { total, modifier: event.modifier, groups };
}
