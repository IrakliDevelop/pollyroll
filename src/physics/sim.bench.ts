import { bench } from 'vitest';
import type { ShapeType } from '../geometry/polyhedra';
import { simulate } from './sim';
import type { SimInput } from './sim';

const CYCLE: ShapeType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
const shapes = Array.from({ length: 10 }, (_, k) => CYCLE[k % CYCLE.length] ?? 'd6');

// Settle-acceptance input for seed 0 (see sim.test.ts).
const input: SimInput = {
  seed: '00000000000000000000000000000000',
  shapes,
  waves: shapes.map(() => 0),
  bounds: { minX: -6, maxX: 6, minZ: -4, maxZ: 4 },
};

bench('10 dice to settle', () => {
  simulate(input);
});
