/**
 * Your own stop moves (stop_moves.source = "user"). Sync only ever rebuilds "auto" rows (src/server/protection/apply.ts),
 * so these survive every re-sync and rebuild. Auto rows mirror the exchange and can't be edited or deleted here.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import * as s from "../db/schema";

// time inputs have minute precision, so a move within a minute of the entry or exit is still accepted
const MIN_SKEW_MS = 60_000;

export const StopMoveInputSchema = z.object({
  time: z.number().int().positive(),
  price: z.number().finite().positive(),
  note: z
    .string()
    .max(500)
    .nullish()
    .transform((v) => (v?.trim() ? v.trim() : null)),
});

export type StopMoveRow = { id: string; time: number; price: number; source: "auto" | "user"; note: string | null };
export type StopMoveResult = { ok: true; moves: StopMoveRow[] } | { ok: false; error: string };

async function listMoves(db: DB, tradeId: string): Promise<StopMoveRow[]> {
  const rows = await db.select().from(s.stopMoves).where(eq(s.stopMoves.tradeId, tradeId)).orderBy(asc(s.stopMoves.time), asc(s.stopMoves.id));
  return rows.map((m) => ({ id: m.id, time: m.time, price: m.price, source: m.source, note: m.note }));
}

/** The trade, if it belongs to the account and isn't deleted. */
async function ownTrade(db: DB, accountId: string, tradeId: string) {
  return db.query.trades.findFirst({ where: and(eq(s.trades.id, tradeId), eq(s.trades.accountId, accountId), isNull(s.trades.deletedAt)) });
}

function checkTime(trade: NonNullable<Awaited<ReturnType<typeof ownTrade>>>, time: number): string | null {
  if (trade.entryTime !== null && time < trade.entryTime - MIN_SKEW_MS) return "A stop move can't be before the entry";
  const end = trade.exitTime ?? Date.now();
  if (time > end + MIN_SKEW_MS) return trade.exitTime ? "A stop move can't be after the exit" : "A stop move can't be in the future";
  return null;
}

export async function addStopMove(db: DB, accountId: string, tradeId: string, raw: unknown): Promise<StopMoveResult> {
  const parsed = StopMoveInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Enter a time and a price above 0" };
  const trade = await ownTrade(db, accountId, tradeId);
  if (!trade) return { ok: false, error: "Trade not found" };
  const bad = checkTime(trade, parsed.data.time);
  if (bad) return { ok: false, error: bad };
  await db.insert(s.stopMoves).values({ tradeId, ...parsed.data, source: "user" });
  return { ok: true, moves: await listMoves(db, tradeId) };
}

/** The user-owned move with its trade, if both belong to the account. */
async function ownUserMove(db: DB, accountId: string, moveId: string) {
  const move = await db.query.stopMoves.findFirst({ where: eq(s.stopMoves.id, moveId) });
  if (!move || move.source !== "user") return null;
  const trade = await ownTrade(db, accountId, move.tradeId);
  return trade ? { move, trade } : null;
}

export async function updateStopMove(db: DB, accountId: string, moveId: string, raw: unknown): Promise<StopMoveResult> {
  const parsed = StopMoveInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Enter a time and a price above 0" };
  const own = await ownUserMove(db, accountId, moveId);
  if (!own) return { ok: false, error: "Only your own stop moves can be edited" };
  const bad = checkTime(own.trade, parsed.data.time);
  if (bad) return { ok: false, error: bad };
  await db.update(s.stopMoves).set(parsed.data).where(eq(s.stopMoves.id, moveId));
  return { ok: true, moves: await listMoves(db, own.trade.id) };
}

export async function deleteStopMove(db: DB, accountId: string, moveId: string): Promise<StopMoveResult> {
  const own = await ownUserMove(db, accountId, moveId);
  if (!own) return { ok: false, error: "Only your own stop moves can be deleted" };
  await db.delete(s.stopMoves).where(eq(s.stopMoves.id, moveId));
  return { ok: true, moves: await listMoves(db, own.trade.id) };
}
