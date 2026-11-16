/**
 * Trading sessions. Each session is a range of hours IN A TIME ZONE (start inclusive, end exclusive; a range
 * with start > end wraps past midnight), e.g. New York 08:00–16:00 America/New_York. Anchoring sessions to
 * the market's own zone keeps them right across daylight saving: New York's session moves an hour in UTC when
 * the US changes clocks, and a fixed UTC range would mislabel those trades.
 *
 * Sessions are checked in order and the FIRST match wins, so overlaps resolve by priority (New York before
 * London covers the overlap as New York).
 */
import { TZDate } from "@date-fns/tz";

export type SessionDef = { name: string; start: number; end: number; tz: string };
/** The pre-2026-11 shape: whole UTC hours. Still accepted (read as tz "UTC"). */
type LegacySession = { name: string; startUtc: number; endUtc: number };

export const SESSION_ZONES = [
  { tz: "UTC", label: "UTC" },
  { tz: "America/New_York", label: "New York" },
  { tz: "Europe/London", label: "London" },
  { tz: "Asia/Tokyo", label: "Tokyo" },
  { tz: "Asia/Hong_Kong", label: "Hong Kong" },
  { tz: "Asia/Singapore", label: "Singapore" },
  { tz: "Australia/Sydney", label: "Sydney" },
  { tz: "Australia/Melbourne", label: "Melbourne" },
] as const;

/** Daylight-saving-aware defaults; together they cover the whole day. */
export const DEFAULT_SESSIONS: SessionDef[] = [
  { name: "New York", start: 8, end: 16, tz: "America/New_York" },
  { name: "London", start: 8, end: 16.5, tz: "Europe/London" },
  { name: "Asia", start: 9, end: 17, tz: "Asia/Tokyo" },
  { name: "Late Night", start: 16, end: 20, tz: "America/New_York" },
];

/** The old fixed-UTC defaults; a stored copy of exactly these is upgraded to DEFAULT_SESSIONS. */
export const LEGACY_DEFAULT_SESSIONS: LegacySession[] = [
  { name: "Asia", startUtc: 0, endUtc: 7 },
  { name: "London", startUtc: 7, endUtc: 13 },
  { name: "New York", startUtc: 13, endUtc: 20 },
  { name: "Late Night", startUtc: 20, endUtc: 24 },
];

function validTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Accept stored sessions in either shape; drop anything malformed. */
export function normalizeSessions(raw: unknown): SessionDef[] {
  if (!Array.isArray(raw)) return DEFAULT_SESSIONS;
  if (JSON.stringify(raw) === JSON.stringify(LEGACY_DEFAULT_SESSIONS)) return DEFAULT_SESSIONS;
  const out: SessionDef[] = [];
  for (const s of raw as Record<string, unknown>[]) {
    if (!s || typeof s.name !== "string") continue;
    if (typeof s.start === "number" && typeof s.end === "number") out.push({ name: s.name, start: s.start, end: s.end, tz: validTz(s.tz) ? s.tz : "UTC" });
    else if (typeof s.startUtc === "number" && typeof s.endUtc === "number") out.push({ name: s.name, start: s.startUtc, end: s.endUtc, tz: "UTC" });
  }
  return out.length ? out : DEFAULT_SESSIONS;
}

const hourIn = (ts: number, tz: string) => {
  const d = new TZDate(ts, tz);
  return d.getHours() + d.getMinutes() / 60;
};

/** Which session a timestamp falls in (first match wins), or null. */
export function sessionFor(ts: number, sessions: SessionDef[]): string | null {
  for (const s of sessions) {
    const h = hourIn(ts, s.tz);
    const inRange = s.start <= s.end ? h >= s.start && h < s.end : h >= s.start || h < s.end;
    if (inRange) return s.name;
  }
  return null;
}

const hhmm = (h: number) => {
  const whole = Math.floor(h);
  const m = Math.round((h - whole) * 60);
  return `${String(whole % 24 === 0 && whole === 24 ? 24 : whole).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const zoneLabel = (tz: string) => SESSION_ZONES.find((z) => z.tz === tz)?.label ?? tz;

/** "08:00–16:00 New York time" */
export function describeSession(s: SessionDef) {
  return `${hhmm(s.start)}–${hhmm(s.end)} ${s.tz === "UTC" ? "UTC" : `${zoneLabel(s.tz)} time`}`;
}

/** The same hours as they fall at `at` in another zone, e.g. "13:00–21:00 UTC" (changes with daylight saving). */
export function sessionHoursIn(s: SessionDef, at: number, tz: string) {
  const base = new TZDate(at, s.tz);
  const startAt = new TZDate(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(s.start), Math.round((s.start % 1) * 60), s.tz);
  const endAt = new TZDate(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(s.end % 24), Math.round((s.end % 1) * 60), s.tz);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmt.format(startAt)}–${s.end === 24 ? fmt.format(new Date(endAt.getTime() + 86_400_000)) : fmt.format(endAt)}`;
}
