"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { savePlaybook, type PlaybookSaveResult } from "@/server/playbook/playbook";

/** Save a strategy's description and rules. */
export async function savePlaybookAction(id: string, input: unknown): Promise<PlaybookSaveResult> {
  const res = await savePlaybook(getDb(), String(id), input);
  if (res.ok) revalidatePath("/playbook");
  return res;
}
