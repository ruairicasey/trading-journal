"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { getActiveAccount } from "@/server/db/queries/settings";
import { createStrategy, saveTradeBasic, type SaveResult } from "@/server/trades/journal";
import { revertToAuto } from "@/server/protection/apply";
import { addStopMove, deleteStopMove, updateStopMove, type StopMoveResult } from "@/server/trades/stop-moves";
import { deleteScreenshot, moveScreenshot, ScreenshotError, updateCaption } from "@/server/screenshots";
import { importSnapshot } from "@/server/tradingview";
import { getConfig } from "@/server/config";
import { demoChartPng } from "@/server/demo/chart-png";
import { createRng } from "@/server/demo/rng";
import type { Shot } from "@/components/trade-form/screenshots";
import { getStorage } from "@/server/storage";

export async function saveTradeBasicAction(tradeId: string, input: unknown, base?: unknown): Promise<SaveResult> {
  const { active } = await getActiveAccount();
  if (!active) return { ok: false, errors: { form: "No account" } };
  const res = await saveTradeBasic(getDb(), active.id, String(tradeId), input, base);
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

export async function revertToAutoAction(tradeId: string, field: "stopLoss" | "takeProfit" | "tpPartials") {
  const f = field === "takeProfit" || field === "tpPartials" ? field : "stopLoss";
  const res = await revertToAuto(getDb(), await accountId(), String(tradeId), f);
  if (res.ok) {
    revalidatePath("/trades");
    revalidatePath("/dashboard");
  }
  return res;
}

/** Your own stop moves. Analytics groups trades by them, so it is refreshed too. */
async function afterStopMove(res: StopMoveResult) {
  if (res.ok) {
    revalidatePath("/trades");
    revalidatePath("/analytics");
  }
  return res;
}

export async function addStopMoveAction(tradeId: string, input: unknown): Promise<StopMoveResult> {
  const { active } = await getActiveAccount();
  if (!active) return { ok: false, error: "No account" };
  return afterStopMove(await addStopMove(getDb(), active.id, String(tradeId), input));
}

export async function updateStopMoveAction(moveId: string, input: unknown): Promise<StopMoveResult> {
  const { active } = await getActiveAccount();
  if (!active) return { ok: false, error: "No account" };
  return afterStopMove(await updateStopMove(getDb(), active.id, String(moveId), input));
}

export async function deleteStopMoveAction(moveId: string): Promise<StopMoveResult> {
  const { active } = await getActiveAccount();
  if (!active) return { ok: false, error: "No account" };
  return afterStopMove(await deleteStopMove(getDb(), active.id, String(moveId)));
}

/** Paste a TradingView snapshot link. The demo never goes online: it stores a generated chart instead. */
export async function importTradingViewAction(tradeId: string, link: string): Promise<{ ok: true; shot: Shot } | { ok: false; error: string }> {
  try {
    const demo = getConfig().isDemo
      ? async () => demoChartPng(createRng(1), { entry: 100, stop: 98, target: 104, direction: "long" })
      : undefined;
    const shot = await importSnapshot(getDb(), getStorage(), { accountId: await accountId(), tradeId: String(tradeId), link: String(link).slice(0, 300) }, demo);
    return { ok: true, shot };
  } catch (e) {
    if (e instanceof ScreenshotError) return { ok: false, error: e.message };
    console.error("tradingview import failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Import failed" };
  }
}
