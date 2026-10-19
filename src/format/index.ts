import type { RollEvent, RollSummary } from '../core/types';

const joiner = (n: number): string => (n < 0 ? ' - ' : ' + ');

/** One-line plain text of a roll: notation, dice per group, modifier, and total. */
export function formatRoll(event: RollEvent, summary: RollSummary): string {
  const groups = summary.groups.map(({ sign, dice, dropped, subtotal, success }, i) => {
    const values = dice.map((v, j) => {
      if (v === null) return '?';
      return dropped.includes(j) ? `(${v})` : `${v}`;
    });
    let text = `[${values.join(', ')}]`;
    if (success) text += `${success.op}${success.n}: ${subtotal === null ? '?' : sign * subtotal}`;
    if (i > 0) return joiner(sign) + text;
    return sign < 0 ? `-${text}` : text;
  });
  const m = summary.modifier;
  const modifier = m === 0 ? '' : joiner(m) + Math.abs(m);
  return `${event.notation}: ${groups.join('')}${modifier} = ${summary.total ?? '?'}`;
}
