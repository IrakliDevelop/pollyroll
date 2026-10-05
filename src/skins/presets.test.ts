import { describe, expect, it } from 'vitest';
import {
  brass,
  classic,
  defineSkin,
  oak,
  obsidian,
  registerSkin,
  resolveSkin,
  ruby,
  sapphire,
  skinRegistry,
} from './presets';
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

describe('presets', () => {
  it('match the specified skins exactly and resolve by name', () => {
    const expected: Record<string, [Skin, Skin]> = {
      obsidian: [
        obsidian,
        {
          material: 'stone',
          color: ['#0b0b0f', '#2c2c36'],
          labelColor: '#d9b45a',
          pattern: 'marble',
          labelStyle: 'engraved',
        },
      ],
      brass: [
        brass,
        {
          material: 'metal',
          color: ['#b8893a', '#8a6526'],
          labelColor: '#2a1c0a',
          pattern: 'gradient',
          labelStyle: 'embossed',
        },
      ],
      oak: [
        oak,
        {
          material: 'wood',
          color: ['#a87444', '#6b4424'],
          labelColor: '#f6ead6',
          pattern: 'wood',
          labelStyle: 'engraved',
        },
      ],
      sapphire: [
        sapphire,
        { material: 'glass', color: '#1d4fd6', labelColor: '#ffffff', labelStyle: 'printed' },
      ],
      ruby: [
        ruby,
        {
          material: 'gem',
          color: ['#a3102b', '#e8334f'],
          labelColor: '#ffe7a3',
          pattern: 'swirl',
          labelStyle: 'printed',
        },
      ],
    };
    for (const [name, [preset, skin]] of Object.entries(expected)) {
      expect(preset).toStrictEqual(skin);
      expect(resolveSkin(name)).toBe(preset);
    }
  });
});

describe('defineSkin', () => {
  it('merges overrides over a resolved base without mutating it', () => {
    const snapshot = { ...oak };
    const skin = defineSkin('oak', { labelColor: '#000', pattern: 'speckle' });
    expect(skin).toEqual({ ...snapshot, labelColor: '#000', pattern: 'speckle' });
    expect(skin).not.toBe(oak);
    expect(oak).toStrictEqual(snapshot);
  });

  it('accepts an inline base and resolves unknown names to classic', () => {
    expect(defineSkin(ruby, { material: 'glass' })).toEqual({ ...ruby, material: 'glass' });
    expect(defineSkin('no-such-skin', {})).toEqual(classic);
  });
});

describe('registerSkin', () => {
  it('round-trips through resolveSkin', () => {
    const skin = defineSkin('brass', { color: '#888' });
    registerSkin('test-steel', skin);
    expect(resolveSkin('test-steel')).toBe(skin);
    skinRegistry.delete('test-steel');
    expect(resolveSkin('test-steel')).toBe(classic);
  });

  it('throws TypeError for an empty name', () => {
    expect(() => registerSkin('', classic)).toThrow(TypeError);
  });
});
