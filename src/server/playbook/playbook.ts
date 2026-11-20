/** The playbook's strategies (vocab items of kind "strategy") and the save for their description and rules. */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import type { PlaybookStrategy } from "../../lib/analytics/playbook";

export const RULES_MAX = 4000;
export const DESCRIPTION_MAX = 500;

/** Every strategy, archived too (the playbook shows an archived one only when it has trades), in your list order. */
export async function listStrategies(db: DB): Promise<PlaybookStrategy[]> {
  return db
    .select({
      id: s.vocabItems.id,
      label: s.vocabItems.label,
      description: s.vocabItems.description,
      rules: s.vocabItems.rules,
      archived: s.vocabItems.archived,
    })
    .from(s.vocabItems)
    .where(eq(s.vocabItems.kind, "strategy"))
    .orderBy(asc(s.vocabItems.sort), asc(s.vocabItems.label));
}

const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.replace(/\r\n/g, "\n").trim() || null);

export const PlaybookInput = z
  .object({
    description: text(DESCRIPTION_MAX).optional(),
    rules: text(RULES_MAX).optional(),
  })
  .strict();

export type PlaybookSaveResult = { ok: true } | { ok: false; error: string };

/** Sets the description and/or rules you sent (a field you didn't send is kept; an empty one is cleared). */
export async function savePlaybook(db: DB, id: string, raw: unknown): Promise<PlaybookSaveResult> {
  const p = PlaybookInput.safeParse(raw);
  if (!p.success)
    return {
      ok: false,
      error: `Keep the description under ${DESCRIPTION_MAX} and the rules under ${RULES_MAX} characters.`,
    };
  const set = p.data;
  if (Object.keys(set).length === 0) return { ok: true };
  const res = await db
    .update(s.vocabItems)
    .set(set)
    .where(and(eq(s.vocabItems.id, String(id)), eq(s.vocabItems.kind, "strategy")))
    .returning({ id: s.vocabItems.id });
  return res.length ? { ok: true } : { ok: false, error: "That strategy no longer exists." };
}
