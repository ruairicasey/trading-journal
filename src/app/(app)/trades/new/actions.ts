"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { getActiveAccount } from "@/server/db/queries/settings";
import { createManualTrade, type CreateResult } from "@/server/trades/manual";

/** accountId: the account the page named; if you switched account in another tab since, nothing is created. */
export async function createManualTradeAction(accountId: string, input: unknown): Promise<CreateResult> {
  const { active } = await getActiveAccount();
  if (!active) return { ok: false, errors: { form: "No account" } };
  if (active.id !== accountId)
    return { ok: false, errors: { form: "You switched account since this page opened. Reload it first." } };
  const res = await createManualTrade(getDb(), active.id, input);
  if (res.ok) {
    revalidatePath("/trades");
    revalidatePath("/dashboard");
    revalidatePath("/analytics");
  }
  return res;
}
