import { cn } from "@/lib/utils";

/** A trade's direction: an arrow glyph and the word, in ink-2 (no colour, no small caps). */
export function Direction({ dir, className }: { dir: string; className?: string }) {
  const long = dir === "long";
  return (
    <span
      data-direction={dir}
      className={cn("text-ink-2 inline-flex items-baseline gap-1 whitespace-nowrap", className)}
    >
      <span aria-hidden="true">{long ? "↗" : "↘"}</span>
      {long ? "Long" : "Short"}
    </span>
  );
}
