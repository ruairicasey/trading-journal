"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { getActiveAccount } from "@/server/db/queries/settings";
import { createStrategy, saveTradeBasic, type SaveResult } from "@/server/trades/journal";

export async function saveTradeBasicAction(tradeId: string, input: unknown): Promise<SaveResult> {
  const { active } = await getActiveAccount();
  if (!active) return { ok: false, errors: { form: "No account" } };
  const res = await saveTradeBasic(getDb(), active.id, String(tradeId), input);
  // Refresh lists/stats; the edit page keeps its own client state, so it isn't revalidated here.
  if (res.ok) {
    revalidatePath("/trades");
    revalidatePath("/dashboard");
  }
  return res;
}

export async function createStrategyAction(label: string): Promise<string> {
  const id = await createStrategy(getDb(), label);
  revalidatePath("/settings/journal");
  return id;
}
