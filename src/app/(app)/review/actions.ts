"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { getActiveAccount } from "@/server/db/queries/settings";
import { loadTradeForEdit } from "@/server/trades/journal";
import { saveTradeReview, type ReviewSaveResult } from "@/server/trades/review";

/** One trade of the review queue, loaded the same way as the edit page. */
export async function loadReviewTradeAction(tradeId: string) {
  const { active } = await getActiveAccount();
  if (!active) return null;
  return loadTradeForEdit(getDb(), active.id, String(tradeId));
}

/** Save the review fields that changed (next vs the values shown) and mark the trade reviewed. */
export async function saveReviewAction(
  tradeId: string,
  next: unknown,
  base: unknown,
): Promise<ReviewSaveResult> {
  const { active } = await getActiveAccount();
  if (!active) return { ok: false, error: "No account" };
  const res = await saveTradeReview(getDb(), active.id, String(tradeId), next, base);
  if (res.ok) {
    revalidatePath("/trades");
    revalidatePath("/dashboard");
    revalidatePath("/analytics");
  }
  return res;
}
