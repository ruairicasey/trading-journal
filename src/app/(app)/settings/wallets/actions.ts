"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ADDRESS_RE } from "@/lib/format";
import { moveWalletTo } from "@/server/wallets/move";

const idStr = z.string().min(1).max(64);

export async function addWallet(input: { address: string; label: string; kind: string; accountId: string }) {
  const p = z
    .object({
      address: z
        .string()
        .trim()
        .regex(ADDRESS_RE, "Enter a 0x… wallet address (42 characters). Never a private key.")
        .transform((a) => a.toLowerCase()),
      label: z.string().trim().min(1).max(60),
      kind: z.enum(s.WALLET_KINDS),
      accountId: idStr,
    })
    .parse(input);
  const db = getDb();
  const existing = await db.query.wallets.findFirst({ where: eq(s.wallets.address, p.address) });
  if (existing) {
    if (existing.enabled) throw new Error("That wallet is already added.");
    await db.update(s.wallets).set({ enabled: true, label: p.label, kind: p.kind }).where(eq(s.wallets.id, existing.id));
  } else {
    await db.insert(s.wallets).values(p);
  }
  revalidatePath("/", "layout");
}

export async function updateWallet(input: { id: string; label?: string; kind?: string; enabled?: boolean; autoSync?: boolean }) {
  const p = z
    .object({
      id: idStr,
      label: z.string().trim().min(1).max(60).optional(),
      kind: z.enum(s.WALLET_KINDS).optional(),
      enabled: z.boolean().optional(),
      autoSync: z.boolean().optional(),
    })
    .parse(input);
  const { id, ...set } = p;
  if (!Object.keys(set).length) return;
  await getDb().update(s.wallets).set(set).where(eq(s.wallets.id, id));
  revalidatePath("/", "layout");
}

/**
 * Move a wallet to another journal account. Its trades go with it (they belong to whichever account owns the
 * wallet); their journal entries, screenshots and stop moves hang off the trade, so they move untouched.
 * Manual trades and notes stay where they are. Reversible: move it back.
 */
export async function moveWallet(input: { id: string; accountId: string }) {
  const p = z.object({ id: idStr, accountId: idStr }).parse(input);
  const moved = await moveWalletTo(getDb(), p.id, p.accountId);
  revalidatePath("/", "layout");
  return moved;
}
