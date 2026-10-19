import { fires, matches } from './dice';
import { parse } from './notation';
import type { DiceTerm, RolledDie, RollEvent, RollGroupSummary, RollSummary } from './types';

const ascending = (list: [number, number][]): number[] =>
  list.map(([, i]) => i).sort((a, b) => a - b);

export function evaluate(event: RollEvent): RollSummary {
  const buckets = parse(event.notation)
    .terms.filter((t): t is DiceTerm => t.kind === 'dice')
    .map((term) => ({ term, dice: [] as RolledDie[] }));
  for (const die of event.dice) {
    const bucket = buckets[die.group];
    if (!bucket) throw new TypeError(`die group ${die.group} is out of range`);
    bucket.dice.push(die);
  }

  let total: number | null = event.modifier;
  const groups = buckets.map(({ term, dice: rolled }): RollGroupSummary => {
    const { die, sign, success } = term;
    const dice = rolled.map((d) => d.value);
    // Dice per wave not yet matched to the die they reroll.
    const spare: number[] = [];
    for (const { wave } of rolled) spare[wave] = (spare[wave] ?? 0) + 1;
    const pairs: [number, number][] = [];
    const rerolled: [number, number][] = [];
    rolled.forEach(({ value, wave }, i) => {
      if (value === null) return;
      const left = spare[wave + 1] ?? 0;
      if (term.reroll && left > 0 && fires(term, value, wave)) {
        spare[wave + 1] = left - 1;
        rerolled.push([value, i]);
      } else {
        pairs.push([value, i]);
      }
    });
    if (dice.includes(null)) {
      total = null;
      return { die, sign, dice, kept: [], dropped: [], subtotal: null, success };
    }
    let keep = pairs;
    let drop: [number, number][] = [];
    if (term.keep) {
      const { mode, n } = term.keep;
      const dir = mode[1] === 'h' ? -1 : 1;
      const rest = pairs.slice().sort(([va, a], [vb, b]) => dir * (va - vb) || a - b);
      const first = rest.splice(0, n);
      [keep, drop] = mode[0] === 'k' ? [first, rest] : [rest, first];
    }
    let subtotal = 0;
    for (const [v] of keep) {
      if (!term.success) subtotal += term.sign * v;
      else if (matches(term.success, v)) subtotal += term.sign;
    }
    if (total !== null) total += subtotal;
    const dropped = ascending([...drop, ...rerolled]);
    return { die, sign, dice, kept: ascending(keep), dropped, subtotal, success };
  });

  return { total, modifier: event.modifier, groups };
}
