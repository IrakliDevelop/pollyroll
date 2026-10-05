import type { SkinRef } from 'pollyroll';

/** True when `next` is defined and differs by value from the last applied skin. */
export const skinChanged = (
  next: SkinRef | undefined,
  last: SkinRef | undefined,
): next is SkinRef => next !== undefined && JSON.stringify(next) !== JSON.stringify(last);
