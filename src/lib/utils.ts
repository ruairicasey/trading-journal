import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge, told about the type scale in globals.css (text-13 … text-52), so a custom size is never mistaken
 * for a text colour and dropped next to one (e.g. "text-13 text-ink-2").
 */
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["13", "15", "17", "22", "26", "52"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
