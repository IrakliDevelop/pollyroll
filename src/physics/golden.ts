import { simulate, trackHash } from './sim';
import type { SimInput } from './sim';
import type { TrayBounds } from './world';

const BOUNDS: TrayBounds = { minX: -6, maxX: 6, minZ: -4, maxZ: 4 };

/** Fixed simulation inputs whose combined trajectory hash pins the physics across engines. */
export const GOLDEN_CASES: readonly SimInput[] = [
  { seed: '0123456789abcdef0123456789abcdef', shapes: ['d20'], waves: [0], bounds: BOUNDS },
  {
    seed: 'fedcba9876543210fedcba9876543210',
    shapes: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'],
    waves: [0, 0, 0, 0, 0, 0],
    bounds: BOUNDS,
  },
  {
    seed: '00000000000000000000000000000001',
    shapes: ['d6', 'd6', 'd6'],
    waves: [0, 1, 2],
    bounds: BOUNDS,
  },
  {
    seed: 'a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5',
    shapes: ['d6', 'd6', 'd6', 'd6', 'd6', 'd6', 'd6', 'd6', 'd6', 'd6'],
    waves: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bounds: BOUNDS,
  },
];

/** goldenHash() of the final implementation. Changing it requires an explanation of the intended
 *  change in motion. */
export const GOLDEN_HASH = 'fd56c04f';

/** trackHash of each golden case, the four 8-char strings joined, then FNV-1a 32-bit over that
 *  string's char codes; 8 lowercase hex chars. */
export function goldenHash(): string {
  const joined = GOLDEN_CASES.map((input) => trackHash(simulate(input))).join('');
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash = Math.imul(hash ^ joined.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
