import clsx, { type ClassValue } from 'clsx';

/** Tiny helper around clsx so component class composition stays terse. */
export function cn(...args: ClassValue[]): string {
  return clsx(args);
}
