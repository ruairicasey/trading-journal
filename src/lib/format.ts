/** Mask an address for display: 0x12ab…cdef */
export function maskAddr(addr: string) {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "never";
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function fmtDateTime(ts: number | null | undefined, timeZone?: string) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ts);
}

export function fmtUsd(n: number | null | undefined, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function fmtPct(n: number | null | undefined, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(dp)}%`;
}

export function fmtSignedUsd(n: number | null | undefined, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${fmtUsd(n, dp)}`;
}

/** Prices: enough significant digits for both BTC (60,123) and kPEPE (0.004596). */
export function fmtPrice(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  const dp = abs >= 1000 ? 1 : abs >= 1 ? 3 : Math.min(8, 2 - Math.floor(Math.log10(abs)) + 2);
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

export function fmtSize(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function fmtDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined || ms < 0) return "—";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function fmtR(r: number | null | undefined) {
  if (r === null || r === undefined || !Number.isFinite(r)) return "—";
  return `${r > 0 ? "+" : ""}${r.toFixed(2)}R`;
}

export function pnlClass(n: number | null | undefined) {
  if (!n) return "text-muted-foreground";
  return n > 0 ? "text-profit" : "text-loss";
}
