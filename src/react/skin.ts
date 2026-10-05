import type { SkinRef } from 'pollyroll';

/** True when `next` differs by value from the last applied skin. */
export const skinChanged = (next: SkinRef, last: SkinRef | undefined): boolean =>
  JSON.stringify(next) !== JSON.stringify(last);
