import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * `cn` — the canonical shadcn/mapcn class-merger.
 * Combines clsx (conditional class building) + tailwind-merge (resolves
 * conflicting Tailwind utilities so `cn('p-2', condition && 'p-4')` ends up
 * as `p-4` not `p-2 p-4`).
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
