import { describe, expect, it } from 'vitest';
import * as core from './index';

describe('pollyroll core entry', () => {
  it('exports exactly the v1 API', () => {
    expect(Object.keys(core).sort()).toEqual([
      'PollyrollSyntaxError',
      'createRoll',
      'evaluate',
      'isRollEvent',
      'parse',
      'redact',
    ]);
  });

  it('runs in the default node environment', () => {
    expect(typeof document).toBe('undefined');
    const event = core.createRoll('2d6+1');
    expect(core.isRollEvent(event)).toBe(true);
    expect(core.evaluate(event).total).toBeGreaterThanOrEqual(3);
    expect(core.parse('d20').terms).toHaveLength(1);
    expect(core.redact(event).dice[0]?.value).toBeNull();
    expect(new core.PollyrollSyntaxError('x', 0)).toBeInstanceOf(Error);
  });
});
