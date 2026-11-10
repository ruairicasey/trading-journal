"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { getActiveAccount, getSetting } from "@/server/db/queries/settings";
import { searchEverything } from "@/server/db/queries/trades";
import * as m from "@/server/trades/mutations";

const id = z.string().min(1).max(64);

async function accountId() {
  const { active } = await getActiveAccount();
  if (!active) throw new Error("No account");
  return active.id;
}

function done() {
  revalidatePath("/trades");
  revalidatePath("/dashboard");
}

export async function deleteTradeAction(tradeId: string) {
  const ok = await m.softDeleteTrade(getDb(), await accountId(), id.parse(tradeId));
  done();
  return ok;
}

export async function restoreTradeAction(tradeId: string) {
  const ok = await m.restoreTrade(getDb(), await accountId(), id.parse(tradeId));
  done();
  return ok;
}

export async function duplicateTradeAction(tradeId: string) {
  const newId = await m.duplicateAsPlanned(getDb(), await accountId(), id.parse(tradeId));
  done();
  return newId;
}

const Note = z.object({
  title: z.string().trim().max(200).nullish(),
  body: z.string().max(20_000),
  date: z.number().int().min(0),
});

export async function saveNoteAction(input: { id?: string } & z.input<typeof Note>) {
  const { id: noteId, ...rest } = input;
  const p = Note.parse(rest);
  const acc = await accountId();
  if (noteId) await m.updateNote(getDb(), acc, id.parse(noteId), p);
  else await m.createNote(getDb(), acc, p);
  done();
}

export async function deleteNoteAction(noteId: string) {
  await m.deleteNote(getDb(), await accountId(), id.parse(noteId));
  done();
}

export async function commandSearchAction(q: string) {
  const query = z.string().trim().max(100).parse(q);
  const tz = await getSetting("timezone", getConfig().timezone);
  return searchEverything(getDb(), await accountId(), query, { tz });
}
