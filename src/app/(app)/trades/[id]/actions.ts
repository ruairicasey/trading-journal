"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { getActiveAccount } from "@/server/db/queries/settings";
import { createStrategy, saveTradeBasic, type SaveResult } from "@/server/trades/journal";
import { deleteScreenshot, moveScreenshot, updateCaption } from "@/server/screenshots";
import { getStorage } from "@/server/storage";

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

async function accountId() {
  const { active } = await getActiveAccount();
  if (!active) throw new Error("No account");
  return active.id;
}

export async function updateScreenshotCaptionAction(id: string, caption: string | null) {
  await updateCaption(getDb(), await accountId(), String(id), caption === null ? null : String(caption));
}

export async function moveScreenshotAction(id: string, direction: "left" | "right") {
  await moveScreenshot(getDb(), await accountId(), String(id), direction === "left" ? "left" : "right");
}

export async function deleteScreenshotAction(id: string) {
  await deleteScreenshot(getDb(), getStorage(), await accountId(), String(id));
}
