import type { Skin, SkinRef } from './types';

/** White plastic with black printed labels; the default skin. */
export const classic: Skin = {
  material: 'plastic',
  color: '#f4f1ea',
  labelColor: '#1a1a1a',
  labelStyle: 'printed',
};

/** Black marbled stone with engraved gold labels. */
export const obsidian: Skin = {
  material: 'stone',
  color: ['#0b0b0f', '#2c2c36'],
  labelColor: '#d9b45a',
  pattern: 'marble',
  labelStyle: 'engraved',
};

/** Graded brass with engraved dark labels. */
export const brass: Skin = {
  material: 'metal',
  color: ['#b8893a', '#8a6526'],
  labelColor: '#1b1209',
  pattern: 'gradient',
  labelStyle: 'engraved',
};

/** Ringed oak with engraved cream labels. */
export const oak: Skin = {
  material: 'wood',
  color: ['#a87444', '#6b4424'],
  labelColor: '#f6ead6',
  pattern: 'wood',
  labelStyle: 'engraved',
};

/** Blue glass with white printed labels. */
export const sapphire: Skin = {
  material: 'glass',
  color: '#1d4fd6',
  labelColor: '#ffffff',
  labelStyle: 'printed',
};

/** Swirled red gem with printed pale-gold labels. */
export const ruby: Skin = {
  material: 'gem',
  color: ['#8c0a22', '#b5142f'],
  labelColor: '#ffe7a3',
  pattern: 'swirl',
  labelStyle: 'printed',
};

/** Named skins, pre-seeded with the presets. */
export const skinRegistry = new Map<string, Skin>([
  ['classic', classic],
  ['obsidian', obsidian],
  ['brass', brass],
  ['oak', oak],
  ['sapphire', sapphire],
  ['ruby', ruby],
]);

/** Inline skins resolve to themselves; names resolve through the registry; anything else → classic. */
export function resolveSkin(ref: SkinRef | undefined): Skin {
  if (typeof ref === 'object') return ref;
  return (ref === undefined ? undefined : skinRegistry.get(ref)) ?? classic;
}

/** A new skin: the resolved base with `overrides` applied on top. The base is not modified. */
export function defineSkin(base: SkinRef, overrides: Partial<Skin>): Skin {
  return { ...resolveSkin(base), ...overrides };
}

/** Adds or replaces the named preset `name`. Throws TypeError for an empty name. */
export function registerSkin(name: string, skin: Skin): void {
  if (name === '') throw new TypeError('skin name must not be empty');
  skinRegistry.set(name, skin);
}
