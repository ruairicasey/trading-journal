export type SessionDef = { name: string; startUtc: number; endUtc: number };

/**
 * Which trading session a timestamp falls in. Sessions are UTC hour ranges, start inclusive,
 * end exclusive; a range with start > end wraps past midnight (e.g. 22 → 3).
 */
export function sessionFor(ts: number, sessions: SessionDef[]): string | null {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  for (const s of sessions) {
    const inRange = s.startUtc <= s.endUtc ? h >= s.startUtc && h < s.endUtc : h >= s.startUtc || h < s.endUtc;
    if (inRange) return s.name;
  }
  return null;
}
