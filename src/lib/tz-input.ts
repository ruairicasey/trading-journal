/** <input type="datetime-local"> values interpreted in the ACCOUNT timezone, not the browser's. */
import { TZDate } from "@date-fns/tz";

const pad = (n: number) => String(n).padStart(2, "0");

export function toTzInput(ts: number | null | undefined, tz: string): string {
  if (ts === null || ts === undefined) return "";
  const d = new TZDate(ts, tz);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromTzInput(value: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const d = new TZDate(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], tz);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
