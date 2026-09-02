import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names, letting later Tailwind utilities win. @public */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Spread onto a `<DialogContent>` holding a form worth not losing. Blocks the
 * two accidental-dismiss paths, backdrop click and Escape, that would silently
 * discard what was typed. Cancel, the X and submit still close it.
 *
 * @public
 */
export const preventAccidentalDialogClose = {
  onPointerDownOutside: (e: Event) => e.preventDefault(),
  onEscapeKeyDown: (e: Event) => e.preventDefault(),
};
