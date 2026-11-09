"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ACTIVE_ACCOUNT_COOKIE, setSetting } from "@/server/db/queries/settings";

const kind = z.enum(s.VOCAB_KINDS);
const label = z.string().trim().min(1).max(120);
const idStr = z.string().min(1).max(64);

function done() {
  revalidatePath("/settings", "layout");
}

// ─── vocab items ─────────────────────────────────────────────────────────────────
export async function addVocabItem(input: { kind: string; label: string; categoryId?: string | null }) {
  const p = z.object({ kind, label, categoryId: idStr.nullish() }).parse(input);
  const db = getDb();
  const siblings = await db
    .select({ sort: s.vocabItems.sort })
    .from(s.vocabItems)
    .where(
      and(
        eq(s.vocabItems.kind, p.kind),
        p.categoryId ? eq(s.vocabItems.categoryId, p.categoryId) : isNull(s.vocabItems.categoryId),
      ),
    );
  const sort = siblings.reduce((m, r) => Math.max(m, r.sort), -1) + 1;
  await db.insert(s.vocabItems).values({ kind: p.kind, label: p.label, categoryId: p.categoryId ?? null, sort });
  done();
}

export async function updateVocabItem(input: {
  id: string;
  label?: string;
  favorite?: boolean;
  archived?: boolean;
  categoryId?: string | null;
}) {
  const p = z
    .object({
      id: idStr,
      label: label.optional(),
      favorite: z.boolean().optional(),
      archived: z.boolean().optional(),
      categoryId: idStr.nullish(),
    })
    .parse(input);
  const { id, ...set } = p;
  if (Object.keys(set).length === 0) return;
  await getDb().update(s.vocabItems).set(set).where(eq(s.vocabItems.id, id));
  done();
}

/** Move an item up/down within its kind+category by swapping sort with its neighbour. */
export async function moveVocabItem(input: { id: string; direction: "up" | "down" }) {
  const p = z.object({ id: idStr, direction: z.enum(["up", "down"]) }).parse(input);
  const db = getDb();
  const item = await db.query.vocabItems.findFirst({ where: eq(s.vocabItems.id, p.id) });
  if (!item) return;
  const siblings = await db
    .select()
    .from(s.vocabItems)
    .where(
      and(
        eq(s.vocabItems.kind, item.kind),
        item.categoryId ? eq(s.vocabItems.categoryId, item.categoryId) : isNull(s.vocabItems.categoryId),
      ),
    )
    .orderBy(asc(s.vocabItems.sort), asc(s.vocabItems.label));
  const idx = siblings.findIndex((x) => x.id === item.id);
  const swap = p.direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= siblings.length) return;
  [siblings[idx], siblings[swap]] = [siblings[swap], siblings[idx]];
  await db.transaction(async (tx) => {
    for (const [i, row] of siblings.entries()) {
      if (row.sort !== i) await tx.update(s.vocabItems).set({ sort: i }).where(eq(s.vocabItems.id, row.id));
    }
  });
  done();
}

// ─── vocab categories ────────────────────────────────────────────────────────────
export async function addVocabCategory(input: { kind: string; name: string }) {
  const p = z.object({ kind, name: label }).parse(input);
  const db = getDb();
  const rows = await db
    .select({ sort: s.vocabCategories.sort })
    .from(s.vocabCategories)
    .where(eq(s.vocabCategories.kind, p.kind));
  const sort = rows.reduce((m, r) => Math.max(m, r.sort), -1) + 1;
  await db.insert(s.vocabCategories).values({ kind: p.kind, name: p.name, sort, isCustom: true });
  done();
}

export async function updateVocabCategory(input: { id: string; name?: string; archived?: boolean }) {
  const p = z.object({ id: idStr, name: label.optional(), archived: z.boolean().optional() }).parse(input);
  const { id, ...set } = p;
  if (Object.keys(set).length === 0) return;
  await getDb().update(s.vocabCategories).set(set).where(eq(s.vocabCategories.id, id));
  done();
}

// ─── accounts ────────────────────────────────────────────────────────────────────
const AccountInput = z.object({
  name: label,
  type: z.enum(s.ACCOUNT_TYPES),
  startingBalance: z.coerce.number().min(0).max(1e12),
  standardRiskPct: z.coerce.number().min(0).max(100),
  currency: z.string().trim().min(1).max(8).default("USD"),
});

export async function saveAccount(input: { id?: string } & z.input<typeof AccountInput>) {
  const { id, ...rest } = input;
  const p = AccountInput.parse(rest);
  const db = getDb();
  if (id) await db.update(s.accounts).set(p).where(eq(s.accounts.id, idStr.parse(id)));
  else await db.insert(s.accounts).values(p);
  revalidatePath("/", "layout");
}

export async function archiveAccount(id: string) {
  const db = getDb();
  const active = await db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.archived, false));
  if (active.length <= 1) throw new Error("You need at least one active account.");
  await db.update(s.accounts).set({ archived: true }).where(eq(s.accounts.id, idStr.parse(id)));
  revalidatePath("/", "layout");
}

export async function setActiveAccount(id: string) {
  (await cookies()).set(ACTIVE_ACCOUNT_COOKIE, idStr.parse(id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}

// ─── general settings ────────────────────────────────────────────────────────────
const Session = z.object({
  name: label,
  startUtc: z.number().int().min(0).max(24),
  endUtc: z.number().int().min(0).max(24),
});

export async function saveGeneralSettings(input: { timezone: string; sessions: z.input<typeof Session>[] }) {
  const p = z
    .object({
      timezone: z.string().refine((tz) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "Unknown timezone"),
      sessions: z.array(Session).min(1).max(8),
    })
    .parse(input);
  await setSetting("timezone", p.timezone);
  await setSetting("sessions", p.sessions);
  revalidatePath("/", "layout");
}
