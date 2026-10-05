import { getPolyhedron } from './polyhedra';
import type { ShapeType } from './polyhedra';
import type { Vec3 } from './vec';

export type LabelSet = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100tens' | 'd100ones' | 'dF';

const EPS = 1e-9;

function near(a: Vec3, b: Vec3): boolean {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS && Math.abs(a[2] - b[2]) < EPS;
}

/** d4/d6/d8/d10/d12/d20 map to themselves; d100tens/d100ones → d10, dF → d6. */
export function shapeOf(set: LabelSet): ShapeType {
  if (set === 'd100tens' || set === 'd100ones') return 'd10';
  if (set === 'dF') return 'd6';
  return set;
}

/** d6 numbers by explicit outward normal: opposite faces sum to 7. */
const D6_AXES: readonly (readonly [Vec3, number])[] = [
  [[0, 1, 0], 1],
  [[0, 0, 1], 2],
  [[1, 0, 0], 3],
  [[-1, 0, 0], 4],
  [[0, 0, -1], 5],
  [[0, -1, 0], 6],
];

function numberShape(shape: ShapeType): number[] {
  const readouts = getPolyhedron(shape).readouts;
  if (shape === 'd4') return readouts.map((_, i) => i + 1);
  if (shape === 'd6') {
    return readouts.map((r) => {
      const hit = D6_AXES.find(([axis]) => near(axis, r));
      if (hit === undefined) throw new Error('d6 face normal is not axis-aligned');
      return hit[1];
    });
  }
  // Walk faces in order: the first unnumbered face takes the next low number, its opposite the
  // complementary one (N + 1 - k; for d10 digits, 9 - l).
  const high = shape === 'd10' ? 9 : readouts.length + 1;
  let next = shape === 'd10' ? 0 : 1;
  const numbers: number[] = readouts.map(() => -1);
  readouts.forEach((r, i) => {
    if (numbers[i] !== -1) return;
    const j = readouts.findIndex((o) => near(o, [-r[0], -r[1], -r[2]]));
    if (j < 0) throw new Error(`${shape} face ${i} has no opposite face`);
    numbers[i] = next;
    numbers[j] = high - next;
    next++;
  });
  return numbers;
}

const numberCache: Partial<Record<ShapeType, readonly number[]>> = {};

/** Canonical number per readout of a shape (index = readout index). */
export function readoutNumbers(shape: ShapeType): readonly number[] {
  let numbers = numberCache[shape];
  if (numbers === undefined) {
    numbers = numberShape(shape);
    numberCache[shape] = numbers;
  }
  return numbers;
}

function numberAt(set: LabelSet, readout: number): number {
  const n = readoutNumbers(shapeOf(set))[readout];
  if (n === undefined) throw new RangeError(`${set} has no readout ${readout}`);
  return n;
}

/** Text printed for readout i of a label set ('' = blank). */
export function labelText(set: LabelSet, readout: number): string {
  const n = numberAt(set, readout);
  if (set === 'd100tens') return n === 0 ? '00' : `${n}0`;
  if (set === 'dF') return n <= 2 ? '−' : n <= 4 ? '' : '+';
  return String(n);
}

/**
 * Index of readout i in the set's natural label sequence (the index custom labels use):
 * d4..d20 number − 1; d10, d100tens, d100ones the digit; dF 0 = −, 1 = blank, 2 = +.
 */
export function labelIndex(set: LabelSet, readout: number): number {
  const n = numberAt(set, readout);
  if (set === 'dF') return (n - 1) >> 1;
  return shapeOf(set) === 'd10' ? n : n - 1;
}

/** True when the label needs the 6/9 underline. */
export function labelUnderline(set: LabelSet, readout: number): boolean {
  const text = labelText(set, readout);
  const marked = set === 'd10' || set === 'd12' || set === 'd20' || set === 'd100ones';
  return marked && (text === '6' || text === '9');
}

/** Readout index that shows `value`; throws RangeError when no readout shows it. */
export function readoutForValue(set: LabelSet, value: number): number {
  let target: number = value;
  if (set === 'd10') {
    target = Number.isInteger(value) && value >= 1 && value <= 10 ? value % 10 : Number.NaN;
  } else if (set === 'dF') {
    target = value === -1 ? 1 : value === 0 ? 3 : value === 1 ? 5 : Number.NaN;
  }
  const i = readoutNumbers(shapeOf(set)).indexOf(target);
  if (i < 0) throw new RangeError(`${set} cannot show value ${value}`);
  return i;
}
