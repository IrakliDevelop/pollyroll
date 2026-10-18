import { DIE_TYPES, dieRange, matches } from './dice';
import type { Compare, CompareOp, DieType, KeepMode, RollAst, RollTerm } from './types';

export class PollyrollSyntaxError extends Error {
  readonly index: number;

  constructor(message: string, index: number) {
    super(message);
    this.name = 'PollyrollSyntaxError';
    this.index = index;
  }
}

const OPS: readonly CompareOp[] = ['<=', '>=', '<', '>', '='];

export function parse(notation: string): RollAst {
  if (typeof notation !== 'string') {
    throw new PollyrollSyntaxError('Notation must be a string', 0);
  }
  if (notation.length > 256) {
    throw new PollyrollSyntaxError('Notation is longer than 256 characters', 256);
  }

  // Lowercased non-whitespace characters and their indexes in the original string.
  let chars = '';
  const origin: number[] = [];
  notation.split('').forEach((c, i) => {
    if (/\s/.test(c)) return;
    chars += c >= 'A' && c <= 'Z' ? c.toLowerCase() : c;
    origin.push(i);
  });
  if (!chars) {
    throw new PollyrollSyntaxError('Notation is empty', 0);
  }

  let pos = 0;
  const peek = (): string => chars.charAt(pos);
  const word = (w: string): boolean => chars.startsWith(w, pos);
  const atDigit = (): boolean => /\d/.test(peek());
  const fail = (message: string, at: number): PollyrollSyntaxError =>
    new PollyrollSyntaxError(message, origin[at] ?? notation.length);
  const unexpected = (): PollyrollSyntaxError => {
    const c = notation.charAt(origin[pos] ?? notation.length);
    return fail(c ? `Unexpected character "${c}"` : 'Unexpected end of notation', pos);
  };
  const digits = (): string => {
    const start = pos;
    while (atDigit()) pos++;
    return chars.slice(start, pos);
  };

  // `>=N`, `<=N`, `>N`, `<N`, `=N`, or a plain `N` meaning `=N`; errors point at `at`.
  const compare = (at: number): Compare | null => {
    const op = OPS.find(word);
    if (op) pos += op.length;
    else if (!atDigit()) return null;
    const n = digits();
    if (!n) throw fail('Expected a number', at);
    if (Number(n) > 999999) throw fail('Number is larger than 999999', at);
    return { op: op ?? '=', n: Number(n) };
  };

  const parseDie = (): DieType => {
    const c = peek();
    if (c === '%' || c === 'f') {
      pos++;
      return c === '%' ? 'd100' : 'dF';
    }
    const sizeAt = pos;
    const size = digits();
    if (!size) throw unexpected();
    const die = DIE_TYPES.find((t) => t === `d${size}`);
    if (!die) throw fail(`Unsupported die size d${size}`, sizeAt);
    return die;
  };

  const parseTerm = (sign: 1 | -1): RollTerm => {
    let keep: { mode: KeepMode; n: number } | null = null;
    let explode: Compare | null = null;
    let reroll: { on: Compare; once: boolean } | null = null;
    let success: Compare | null = null;
    if (word('adv') || word('dis')) {
      keep = { mode: peek() === 'a' ? 'kh' : 'kl', n: 1 };
      pos += 3;
      return { kind: 'dice', sign, count: 2, die: 'd20', keep, explode, reroll, success };
    }

    const countAt = pos;
    let count = 1;
    if (atDigit()) {
      count = Number(digits());
      if (word('adv') || word('dis')) throw fail('adv and dis take no dice count', pos);
      if (peek() !== 'd') {
        if (count > 999999) throw fail('Constant is larger than 999999', countAt);
        return { kind: 'constant', sign, value: count };
      }
      if (count < 1 || count > 100) {
        throw fail('Dice count must be between 1 and 100', countAt);
      }
    } else if (peek() !== 'd') {
      throw unexpected();
    }
    pos++;
    const die = parseDie();
    const [min, max] = dieRange(die);
    for (;;) {
      const at = pos;
      const c = peek();
      const next = chars.charAt(pos + 1);
      if (c === '!' || c === 'x' || c === 'r') {
        const r = c === 'r';
        const verb = r ? 'reroll' : 'explode';
        if (r ? reroll : explode) throw fail(`A term can ${verb} only once`, at);
        if (die === 'dF') throw fail(`Fudge dice cannot ${verb}`, at);
        if (reroll || explode) throw fail('A term cannot both explode and reroll', at);
        const once = r && next === 'o';
        pos += once ? 2 : 1;
        const on = compare(at) ?? { op: '=', n: r ? min : max };
        if (matches(on, min) && matches(on, max)) {
          throw fail(`${r ? 'Reroll' : 'Explosion'} matches every face`, at);
        }
        if (r) reroll = { on, once };
        else explode = on;
      } else if (c === '<' || c === '>' || c === '=') {
        if (success) throw fail('A term can count successes only once', at);
        success = compare(at);
      } else if (c === 'k' || c === 'd') {
        if (keep) throw fail('A term can have only one keep or drop', pos);
        // Bare `k` keeps the highest and bare `d` drops the lowest.
        const side = next === 'h' || next === 'l' ? next : c === 'k' ? 'h' : 'l';
        const mode: KeepMode = `${c}${side}`;
        let nAt = pos;
        pos += next === side ? 2 : 1;
        let n = 1;
        if (atDigit()) {
          nAt = pos;
          n = Number(digits());
        }
        if (n < 1 || n > count)
          throw fail(`Keep or drop count must be between 1 and ${count}`, nAt);
        keep = { mode, n };
      } else {
        break;
      }
    }
    return { kind: 'dice', sign, count, die, keep, explode, reroll, success };
  };

  const terms: RollTerm[] = [];
  let total = 0;
  for (;;) {
    // A leading sign is optional; every later term starts at its checked `+` or `-`.
    const c = peek();
    const sign = c === '-' ? -1 : 1;
    if (c === '+' || c === '-') pos++;
    const start = pos;
    const term = parseTerm(sign);
    terms.push(term);
    if (terms.length > 20) throw fail('Notation has more than 20 terms', start);
    if (term.kind === 'dice') {
      total += term.count;
      if (total > 200) throw fail('Notation has more than 200 dice', start);
    }
    if (!peek()) break;
    if (peek() !== '+' && peek() !== '-') throw unexpected();
  }
  if (!total) {
    throw new PollyrollSyntaxError('Notation has no dice', 0);
  }
  return { terms };
}
