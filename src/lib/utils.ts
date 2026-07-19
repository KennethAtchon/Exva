import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** Keep in sync with `theme.extend.fontSize` in tailwind.config.js */
const FONT_SIZE_TOKENS = [
  "micro",
  "caption",
  "body",
  "label",
  "data",
  "head",
  "title",
  "stat",
  "hero",
] as const;

// Custom fontSize utilities use the `text-*` prefix. Register them so twMerge
// treats them as font-size, not color (otherwise `text-caption` drops
// `text-primary-foreground` on size="sm" buttons).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": FONT_SIZE_TOKENS.map((token) => `text-${token}`),
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
