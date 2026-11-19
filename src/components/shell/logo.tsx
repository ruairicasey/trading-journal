/** Three rising bars; the tallest is the gold accent. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none" className={className}>
      <rect x="1" y="11" width="4" height="10" rx="1" className="fill-ink" />
      <rect x="9" y="5" width="4" height="16" rx="1" className="fill-ink" />
      <rect x="17" y="1" width="4" height="20" rx="1" className="fill-gold" />
    </svg>
  );
}
