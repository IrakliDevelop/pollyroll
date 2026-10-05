import type { Skin, SkinRef } from './types';

/** White plastic with black printed labels; the default skin. */
export const classic: Skin = {
  material: 'plastic',
  color: '#f4f1ea',
  labelColor: '#1a1a1a',
  labelStyle: 'printed',
};

/** Named skins, pre-seeded with classic. */
export const skinRegistry = new Map<string, Skin>([['classic', classic]]);

/** Inline skins resolve to themselves; names resolve through the registry; anything else → classic. */
export function resolveSkin(ref: SkinRef | undefined): Skin {
  if (typeof ref === 'object') return ref;
  return (ref === undefined ? undefined : skinRegistry.get(ref)) ?? classic;
}
