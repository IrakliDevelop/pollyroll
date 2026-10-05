import { describe, expect, it } from 'vitest';
import { classic, resolveSkin, skinRegistry } from './presets';
import type { Skin } from './types';

describe('resolveSkin', () => {
  it('returns classic for undefined, "classic", and unknown names', () => {
    expect(resolveSkin(undefined)).toBe(classic);
    expect(resolveSkin('classic')).toBe(classic);
    expect(resolveSkin('no-such-skin')).toBe(classic);
  });

  it('returns an inline skin object as is', () => {
    const skin: Skin = { material: 'metal', color: '#888', labelColor: '#fff' };
    expect(resolveSkin(skin)).toBe(skin);
  });

  it('resolves names registered in the registry', () => {
    const skin: Skin = { material: 'wood', color: '#a0522d', labelColor: '#000' };
    skinRegistry.set('test-wood', skin);
    expect(resolveSkin('test-wood')).toBe(skin);
    skinRegistry.delete('test-wood');
  });

  it('classic is white plastic with black printed labels', () => {
    expect(classic).toEqual({
      material: 'plastic',
      color: '#f4f1ea',
      labelColor: '#1a1a1a',
      labelStyle: 'printed',
    });
    expect(skinRegistry.get('classic')).toBe(classic);
  });
});
