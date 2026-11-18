/**
 * CSV writing (RFC 4180): fields with a comma, quote or line break are quoted, quotes doubled, CRLF line ends.
 * Text that a spreadsheet would run as a formula (starting = + - @, tab or CR) gets a leading apostrophe; numbers
 * are written as numbers, so a negative P&L stays a number, and ids (idCell) exactly as they are.
 */
export type Cell = string | number | boolean | null | undefined | { id: string };

/** An id cell: written exactly (ids are letters, digits, _ and -: nothing a spreadsheet can run). */
export const idCell = (id: string): Cell => ({ id });

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (!/^[A-Za-z0-9_-]+$/.test(v.id)) throw new Error("Not an id");
    return v.id;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
