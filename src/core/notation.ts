import { dieRange, matches } from './dice';
import type { Compare, CompareOp, DieType, KeepMode, RollAst, RollTerm } from './types';

export class PollyrollSyntaxError extends Error {
  readonly index: number;

  constructor(message: string, index: number) {
    super(message);
    this.name = 'PollyrollSyntaxError';
    this.index = index;
  }
}

const MAX_LENGTH = 256;
const MAX_TERMS = 20;
const MAX_COUNT = 100;
const MAX_DICE = 200;
const MAX_CONSTANT = 999999;
const WHITESPACE = /\s/;
const OPS: readonly CompareOp[] = ['<=', '>=', '<', '>', '='];
const SIZES: Record<string, DieType> = {
  '4': 'd4',
  '6': 'd6',
  '8': 'd8',
  '10': 'd10',
  '12': 'd12',
  '20': 'd20',
  '100': 'd100',
};

const isDigit = (c: string): boolean => c >= '0' && c <= '9';

export function parse(notation: string): RollAst {
  if (typeof notation !== 'string') {
    throw new PollyrollSyntaxError('Notation must be a string', 0);
  }
  if (notation.length > MAX_LENGTH) {
    throw new PollyrollSyntaxError('Notation is longer than 256 characters', MAX_LENGTH);
  }

  // Lowercased non-whitespace characters and their indexes in the original string.
  const chars: string[] = [];
  const origin: number[] = [];
  for (let i = 0; i < notation.length; i++) {
    const c = notation.charAt(i);
    if (WHITESPACE.test(c)) continue;
    chars.push(c >= 'A' && c <= 'Z' ? c.toLowerCase() : c);
    origin.push(i);
  }
  if (chars.length === 0) {
    throw new PollyrollSyntaxError('Notation is empty', 0);
  }

  let pos = 0;
  const peek = (offset = 0): string => chars[pos + offset] ?? '';
  const word = (w: string): boolean => chars.slice(pos, pos + w.length).join('') === w;
  const fail = (message: string, at: number): PollyrollSyntaxError =>
    new PollyrollSyntaxError(message, origin[at] ?? notation.length);
  const unexpected = (): PollyrollSyntaxError => {
    const at = origin[pos];
    return at === undefined
      ? fail('Unexpected end of notation', pos)
      : fail(`Unexpected character "${notation.charAt(at)}"`, pos);
  };
  const digits = (): string => {
    let s = '';
    while (isDigit(peek())) {
      s += peek();
      pos++;
    }
    return s;
  };

  // `>=N`, `<=N`, `>N`, `<N`, `=N`, or with `bare` a plain `N` meaning `=N`; errors point at `at`.
  const compare = (at: number, bare: boolean): Compare | null => {
    const op = OPS.find(word);
    if (op) pos += op.length;
    else if (!bare || !isDigit(peek())) return null;
    const n = digits();
    if (!n) throw fail('Expected a number', at);
    if (Number(n) > MAX_CONSTANT) throw fail('Number is larger than 999999', at);
    return { op: op ?? '=', n: Number(n) };
  };

  const parseDie = (): DieType => {
    const c = peek();
    if (c === '%' || c === 'f') {
      pos++;
      return c === '%' ? 'd100' : 'dF';
    }
    if (!isDigit(c)) throw unexpected();
    const sizeAt = pos;
    const size = digits();
    const die = SIZES[size];
    if (!die) throw fail(`Unsupported die size d${size}`, sizeAt);
    return die;
  };

  const parseTerm = (sign: 1 | -1): RollTerm => {
    if (word('adv') || word('dis')) {
      const mode: KeepMode = peek() === 'a' ? 'kh' : 'kl';
      pos += 3;
      return {
        kind: 'dice',
        sign,
        count: 2,
        die: 'd20',
        keep: { mode, n: 1 },
        explode: null,
        reroll: null,
        success: null,
      };
    }

    let count = 1;
    if (isDigit(peek())) {
      const countAt = pos;
      count = Number(digits());
      if (word('adv') || word('dis')) throw fail('adv and dis take no dice count', pos);
      if (peek() !== 'd') {
        if (count > MAX_CONSTANT) throw fail('Constant is larger than 999999', countAt);
        return { kind: 'constant', sign, value: count };
      }
      if (count < 1 || count > MAX_COUNT) {
        throw fail('Dice count must be between 1 and 100', countAt);
      }
    } else if (peek() !== 'd') {
      throw unexpected();
    }
    pos++;
    const die = parseDie();
    const [min, max] = dieRange(die);

    let keep: { mode: KeepMode; n: number } | null = null;
    let explode: Compare | null = null;
    let reroll: { on: Compare; once: boolean } | null = null;
    let success: Compare | null = null;
    for (;;) {
      const at = pos;
      const c = peek();
      const next = peek(1);
      if (c === '!' || c === 'x' || c === 'r') {
        const r = c === 'r';
        if (r ? reroll : explode) {
          throw fail(r ? 'A term can reroll only once' : 'A term can explode only once', at);
        }
        if (die === 'dF') throw fail(`Fudge dice cannot ${r ? 'reroll' : 'explode'}`, at);
        if (reroll || explode) throw fail('A term cannot both explode and reroll', at);
        const once = r && next === 'o';
        pos += once ? 2 : 1;
        const on = compare(at, true) ?? { op: '=', n: r ? min : max };
        if (matches(on, min) && matches(on, max)) {
          throw fail(`${r ? 'Reroll' : 'Explosion'} matches every face`, at);
        }
        if (r) reroll = { on, once };
        else explode = on;
      } else if (c === '<' || c === '>' || c === '=') {
        if (success) throw fail('A term can count successes only once', at);
        success = compare(at, false);
      } else if (c === 'k' || c === 'd') {
        if (keep) throw fail('A term can have only one keep or drop', pos);
        // Bare `k` keeps the highest and bare `d` drops the lowest.
        const side = next === 'h' || next === 'l' ? next : c === 'k' ? 'h' : 'l';
        const mode: KeepMode =
          c === 'k' ? (side === 'h' ? 'kh' : 'kl') : side === 'h' ? 'dh' : 'dl';
        let nAt = pos;
        pos += next === side ? 2 : 1;
        let n = 1;
        if (isDigit(peek())) {
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
  let sign: 1 | -1 = 1;
  if (peek() === '+' || peek() === '-') {
    sign = peek() === '-' ? -1 : 1;
    pos++;
  }
  for (;;) {
    const start = pos;
    const term = parseTerm(sign);
    terms.push(term);
    if (terms.length > MAX_TERMS) throw fail('Notation has more than 20 terms', start);
    if (term.kind === 'dice') {
      total += term.count;
      if (total > MAX_DICE) throw fail('Notation has more than 200 dice', start);
    }
    const c = peek();
    if (c === '') break;
    if (c !== '+' && c !== '-') throw unexpected();
    sign = c === '-' ? -1 : 1;
    pos++;
  }
  if (total === 0) {
    throw new PollyrollSyntaxError('Notation has no dice', 0);
  }
  return { terms };
}
