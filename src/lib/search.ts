/**
 * Full-text search: the query is split into terms ("quoted phrases" stay together); a trade or note matches when
 * EVERY term appears somewhere in it (any field), case-insensitive. Snippets show where the first term hit.
 */
export const MAX_TERMS = 8;

export function parseSearch(q: string | undefined | null): string[] {
  if (!q) return [];
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const t = (m[1] ?? m[2] ?? "").trim().toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, MAX_TERMS);
}

export type Seg = { text: string; hit: boolean };

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive matches of the terms in `text`, as [start, end) offsets INTO `text` (phrases first, no overlaps). */
function matches(text: string, terms: string[]): [number, number][] {
  const re = new RegExp(
    [...terms]
      .sort((a, b) => b.length - a.length)
      .map(escapeRe)
      .join("|"),
    "giu",
  );
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) if (m[0].length) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

/** A short excerpt of `text` around the first term found, split into hit / non-hit segments; null if none found. */
export function snippet(text: string | null | undefined, terms: string[], radius = 60): Seg[] | null {
  if (!text || !terms.length) return null;
  const all = matches(text, terms);
  if (!all.length) return null;
  const first = all[0][0];
  let start = Math.max(0, first - radius);
  let end = Math.min(text.length, first + radius * 2);
  // don't cut words in half, but never move past the hit itself
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp !== -1 && sp < first) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp > first) end = sp;
  }
  const segs: Seg[] = [];
  let at = start;
  for (const [a, b] of all) {
    if (b <= start || a >= end) continue;
    const s0 = Math.max(a, start);
    const e0 = Math.min(b, end);
    if (s0 > at) segs.push({ text: text.slice(at, s0), hit: false });
    segs.push({ text: text.slice(s0, e0), hit: true });
    at = e0;
  }
  if (at < end) segs.push({ text: text.slice(at, end), hit: false });
  for (const x of segs) x.text = x.text.replace(/\s+/g, " ");
  if (start > 0) segs.unshift({ text: "…", hit: false });
  if (end < text.length) segs.push({ text: "…", hit: false });
  return segs;
}

/** The first snippet among several fields (in order), with the field's name. */
export function firstSnippet(fields: [label: string, text: string | null | undefined][], terms: string[]) {
  for (const [label, text] of fields) {
    const s = snippet(text, terms);
    if (s) return { label, segs: s };
  }
  return null;
}
