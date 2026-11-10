/**
 * Database schema.
 *
 * OWNERSHIP RULE — the core invariant of this app:
 *   [X] exchange-owned: written ONLY by sync/reconstruction. Never editable in the UI.
 *   [U] user-owned:     written ONLY by the user. Sync never touches these.
 * A re-sync (any range, any number of times) must never overwrite a [U] field.
 *
 * Conventions (kept Postgres-portable): text ids (nanoid), integer ms timestamps (UTC),
 * REAL for computed money, raw Hyperliquid numeric strings kept verbatim as TEXT,
 * booleans as integer {mode:"boolean"}, JSON as text {mode:"json"}.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => nanoid());
const createdAt = () =>
  integer("created_at", { mode: "number" })
    .notNull()
    .$defaultFn(() => Date.now());
const updatedAt = () =>
  integer("updated_at", { mode: "number" })
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdateFn(() => Date.now());

// ─── Enumerations (fixed by the app; user-editable lists live in vocab_items) ───────
export const ACCOUNT_TYPES = ["crypto", "prop", "other"] as const;
export const WALLET_KINDS = ["main", "sub", "vault"] as const;
export const TRADE_SOURCES = ["hyperliquid", "manual"] as const;
export const TRADE_STATUSES = ["planned", "open", "closed"] as const;
export const DIRECTIONS = ["long", "short"] as const;
export const MARKET_TYPES = ["perp", "hip3", "spot"] as const;
export const GRADES = ["A+", "A", "B", "C", "D"] as const;
export const TIMEFRAME_CLASSES = ["LTF", "MTF", "HTF"] as const;
export const TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D", "3D", "1W", "1M"] as const;
export const HTF_TIMEFRAMES = ["30m", "1H", "2H", "4H", "6H", "12H", "1D", "3D", "1W", "1M"] as const;
export const MARKET_CONDITIONS = ["trending", "ranging", "volatile", "choppy"] as const;
export const TRADE_TYPES = ["planned", "reactive"] as const;
export const RULES_FOLLOWED = ["yes", "partial", "no"] as const;
export const SIZE_MODES = ["position", "risk"] as const;
export const VOCAB_KINDS = [
  "strategy",
  "confluence",
  "sl_reason",
  "tp_reason",
  "checklist",
  "exit_reason",
  "mistake",
  "emotion",
] as const;
export type VocabKind = (typeof VOCAB_KINDS)[number];

// ─── [U] settings ───────────────────────────────────────────────────────────────────
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: updatedAt(),
});

// ─── [U] accounts ───────────────────────────────────────────────────────────────────
export const accounts = sqliteTable("accounts", {
  id: id(),
  name: text("name").notNull(),
  type: text("type", { enum: ACCOUNT_TYPES }).notNull().default("crypto"),
  startingBalance: real("starting_balance").notNull().default(0),
  standardRiskPct: real("standard_risk_pct").notNull().default(1),
  currency: text("currency").notNull().default("USD"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
});

// ─── [U+X] wallets ──────────────────────────────────────────────────────────────────
export const wallets = sqliteTable(
  "wallets",
  {
    id: id(),
    // [U]
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    address: text("address").notNull(), // lowercase; stored in DB only, never in code
    label: text("label").notNull().default("Main"),
    kind: text("kind", { enum: WALLET_KINDS }).notNull().default("main"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    autoSync: integer("auto_sync", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    // [X] sync bookkeeping
    lastFillTime: integer("last_fill_time"),
    oldestFillTime: integer("oldest_fill_time"),
    backfillCursor: integer("backfill_cursor"), // resumable chunked backfill
    backfillCompletedAt: integer("backfill_completed_at"),
    lastSyncedAt: integer("last_synced_at"),
    lastSuccessAt: integer("last_success_at"),
    lastFundingTime: integer("last_funding_time"), // funding sync cursor, saved after every page
    historyTruncated: integer("history_truncated", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("wallets_address_uq").on(t.address)],
);

// ─── [X] sync_runs ──────────────────────────────────────────────────────────────────
export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: id(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id),
    trigger: text("trigger", { enum: ["manual", "auto", "cron", "range", "backfill"] }).notNull(),
    rangeStart: integer("range_start"),
    rangeEnd: integer("range_end"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    status: text("status", { enum: ["running", "success", "partial", "error"] }).notNull(),
    pages: integer("pages").notNull().default(0),
    fillsFetched: integer("fills_fetched").notNull().default(0),
    fillsNew: integer("fills_new").notNull().default(0),
    tradesTouched: integer("trades_touched").notNull().default(0),
    gapsDetected: integer("gaps_detected").notNull().default(0),
    done: integer("done", { mode: "boolean" }).notNull().default(true),
    error: text("error"),
  },
  (t) => [index("sync_runs_wallet_started_idx").on(t.walletId, t.startedAt)],
);

// ─── [X] fills (raw Hyperliquid fills; never deleted) ───────────────────────────────
export const fills = sqliteTable(
  "fills",
  {
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id),
    tid: integer("tid").notNull(),
    coin: text("coin").notNull(),
    dex: text("dex").notNull().default(""),
    marketType: text("market_type", { enum: MARKET_TYPES }).notNull(),
    px: text("px").notNull(),
    sz: text("sz").notNull(),
    side: text("side", { enum: ["B", "A"] }).notNull(),
    time: integer("time").notNull(),
    startPosition: text("start_position").notNull(),
    dir: text("dir").notNull(),
    closedPnl: text("closed_pnl").notNull(),
    fee: text("fee").notNull(),
    feeToken: text("fee_token").notNull(),
    builderFee: text("builder_fee"),
    hash: text("hash").notNull(),
    oid: integer("oid").notNull(),
    crossed: integer("crossed", { mode: "boolean" }).notNull(),
    liquidation: text("liquidation", { mode: "json" }),
    twapId: integer("twap_id"),
    raw: text("raw", { mode: "json" }).notNull(),
    ingestedAt: integer("ingested_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (t) => [
    primaryKey({ columns: [t.walletId, t.tid] }),
    index("fills_wallet_coin_time_idx").on(t.walletId, t.coin, t.time),
    index("fills_wallet_time_idx").on(t.walletId, t.time),
  ],
);

// ─── [X] funding_events (raw; attributed to trades in Phase 2) ──────────────────────
// `hash` is kept for reference only; it is the all-zero hash in practice.
export const fundingEvents = sqliteTable(
  "funding_events",
  {
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id),
    hash: text("hash").notNull(),
    coin: text("coin").notNull(),
    time: integer("time").notNull(),
    usdc: text("usdc").notNull(),
    szi: text("szi").notNull(),
    fundingRate: text("funding_rate").notNull(),
    tradeId: text("trade_id"),
  },
  // Keyed by (wallet, coin, time): Hyperliquid returns the all-zero hash on every funding row (verified
  // live 2026-11), so the hash cannot identify a payment. Funding is paid at most once per coin per time.
  (t) => [primaryKey({ columns: [t.walletId, t.coin, t.time] })],
);

// ─── trades ([X] for source=hyperliquid; [U] for source=manual) ─────────────────────
export type TradeFlags = {
  partialHistory?: boolean;
  gap?: boolean;
  superseded?: boolean;
  nonUsdcFee?: boolean;
  liquidated?: boolean;
  liquidationCounterparty?: boolean;
  entryImplied?: boolean;
};

export const trades = sqliteTable(
  "trades",
  {
    id: id(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    walletId: text("wallet_id").references(() => wallets.id),
    source: text("source", { enum: TRADE_SOURCES }).notNull(),
    externalKey: text("external_key"), // walletId:coin:firstTid — stable identity across rebuilds
    coin: text("coin").notNull(),
    displayPair: text("display_pair").notNull(),
    dex: text("dex").notNull().default(""),
    marketType: text("market_type", { enum: MARKET_TYPES }).notNull().default("perp"),
    direction: text("direction", { enum: DIRECTIONS }).notNull(),
    status: text("status", { enum: TRADE_STATUSES }).notNull(),
    avgEntry: real("avg_entry"),
    avgExit: real("avg_exit"),
    sizeUnits: real("size_units"), // max |position| held
    entryUnitsTotal: real("entry_units_total"),
    exitUnitsTotal: real("exit_units_total"),
    notionalUsd: real("notional_usd"),
    grossPnl: real("gross_pnl"),
    fees: real("fees"),
    funding: real("funding").notNull().default(0),
    netPnl: real("net_pnl"),
    returnPct: real("return_pct"),
    entryTime: integer("entry_time"),
    exitTime: integer("exit_time"),
    durationMs: integer("duration_ms"),
    fillCount: integer("fill_count").notNull().default(0),
    leverage: real("leverage"),
    liqPx: real("liq_px"),
    flags: text("flags", { mode: "json" }).$type<TradeFlags>().notNull().default({}),
    reconstructedAt: integer("reconstructed_at"),
    deletedAt: integer("deleted_at"), // soft delete: re-sync never resurrects
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("trades_external_key_uq").on(t.externalKey),
    index("trades_account_entry_idx").on(t.accountId, t.entryTime),
    index("trades_account_status_idx").on(t.accountId, t.status),
  ],
);

// ─── [X] trade_fills — fill legs; one fill can belong to two trades (a flip) ────────
export const tradeFills = sqliteTable(
  "trade_fills",
  {
    tradeId: text("trade_id")
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    walletId: text("wallet_id").notNull(),
    tid: integer("tid").notNull(),
    role: text("role", { enum: ["entry", "exit"] }).notNull(),
    sz: real("sz").notNull(),
    px: real("px").notNull(),
    fee: real("fee").notNull(),
    closedPnl: real("closed_pnl").notNull(),
    time: integer("time").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tradeId, t.walletId, t.tid, t.role] }),
    index("trade_fills_fill_idx").on(t.walletId, t.tid),
  ],
);

// ─── [U] vocab: one editable table for every journal list ──────────────────────────
export const vocabCategories = sqliteTable(
  "vocab_categories",
  {
    id: id(),
    kind: text("kind", { enum: VOCAB_KINDS }).notNull(),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    isCustom: integer("is_custom", { mode: "boolean" }).notNull().default(false),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("vocab_categories_kind_idx").on(t.kind, t.sort)],
);

export const vocabItems = sqliteTable(
  "vocab_items",
  {
    id: id(),
    kind: text("kind", { enum: VOCAB_KINDS }).notNull(),
    categoryId: text("category_id").references(() => vocabCategories.id),
    label: text("label").notNull(),
    description: text("description"),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    sort: integer("sort").notNull().default(0),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("vocab_items_kind_idx").on(t.kind, t.categoryId, t.sort)],
);

// ─── [U] trade_journal — 1:1 with trades; the user's half of every trade ───────────
export const tradeJournal = sqliteTable("trade_journal", {
  tradeId: text("trade_id")
    .primaryKey()
    .references(() => trades.id),
  // Basic
  strategyId: text("strategy_id").references(() => vocabItems.id),
  stopLoss: real("stop_loss"),
  takeProfit: real("take_profit"),
  sizeMode: text("size_mode", { enum: SIZE_MODES }).notNull().default("position"),
  plannedRiskUsd: real("planned_risk_usd"),
  leverageOverride: real("leverage_override"),
  session: text("session"),
  tradeType: text("trade_type", { enum: TRADE_TYPES }),
  feeOverride: real("fee_override"),
  // Analysis
  entryTimeframe: text("entry_timeframe", { enum: TIMEFRAMES }),
  timeframeClass: text("timeframe_class", { enum: TIMEFRAME_CLASSES }),
  marketCondition: text("market_condition", { enum: MARKET_CONDITIONS }),
  htfTimeframes: text("htf_timeframes", { mode: "json" }).$type<string[]>().notNull().default([]),
  emotionBeforeId: text("emotion_before_id").references(() => vocabItems.id),
  grade: text("grade", { enum: GRADES }),
  entryRetests: integer("entry_retests"),
  maxRReached: real("max_r_reached"),
  riskMultiplier: real("risk_multiplier"),
  // Notes / review
  rationale: text("rationale"),
  postNotes: text("post_notes"),
  reflection: text("reflection", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  rulesFollowed: text("rules_followed", { enum: RULES_FOLLOWED }),
  exitReasonId: text("exit_reason_id").references(() => vocabItems.id),
  emotionAfterId: text("emotion_after_id").references(() => vocabItems.id),
  processCompliant: integer("process_compliant", { mode: "boolean" }),
  // Manual-trade inputs (source=manual only)
  manualEntry: real("manual_entry"),
  manualExit: real("manual_exit"),
  manualSize: real("manual_size"),
  manualEntryTime: integer("manual_entry_time"),
  manualExitTime: integer("manual_exit_time"),
  reviewedAt: integer("reviewed_at"),
  updatedAt: updatedAt(),
});

// [U] many-to-many: confluences, SL/TP reasons, ticked checklist items, mistakes
export const tradeVocab = sqliteTable(
  "trade_vocab",
  {
    tradeId: text("trade_id")
      .notNull()
      .references(() => trades.id),
    itemId: text("item_id")
      .notNull()
      .references(() => vocabItems.id),
    kind: text("kind", { enum: VOCAB_KINDS }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tradeId, t.itemId] }), index("trade_vocab_item_idx").on(t.itemId)],
);

export const tradePartials = sqliteTable("trade_partials", {
  id: id(),
  tradeId: text("trade_id")
    .notNull()
    .references(() => trades.id),
  kind: text("kind", { enum: ["entry", "tp"] }).notNull(),
  price: real("price").notNull(),
  sizeUnits: real("size_units"),
  pct: real("pct"),
  sort: integer("sort").notNull().default(0),
});

export const stopMoves = sqliteTable("stop_moves", {
  id: id(),
  tradeId: text("trade_id")
    .notNull()
    .references(() => trades.id),
  time: integer("time").notNull(),
  price: real("price").notNull(),
  note: text("note"),
});

export const notes = sqliteTable(
  "notes",
  {
    id: id(),
    accountId: text("account_id").references(() => accounts.id),
    date: integer("date").notNull(),
    title: text("title"),
    body: text("body").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("notes_account_date_idx").on(t.accountId, t.date)],
);

export const screenshots = sqliteTable(
  "screenshots",
  {
    id: id(),
    tradeId: text("trade_id").references(() => trades.id),
    noteId: text("note_id").references(() => notes.id),
    storageKey: text("storage_key").notNull(),
    sourceUrl: text("source_url"),
    caption: text("caption"),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes"),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("screenshots_trade_idx").on(t.tradeId, t.sort)],
);

export const tags = sqliteTable(
  "tags",
  {
    id: id(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("tags_name_uq").on(sql`lower(${t.name})`)],
);

export const tradeTags = sqliteTable(
  "trade_tags",
  {
    tradeId: text("trade_id")
      .notNull()
      .references(() => trades.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.tradeId, t.tagId] })],
);

export const savedFilters = sqliteTable("saved_filters", {
  id: id(),
  name: text("name").notNull(),
  query: text("query", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
  sort: integer("sort").notNull().default(0),
});

// ─── [X] auth_attempts — login rate limiting (keyed by a keyed hash of the client IP, never the IP) ─
export const authAttempts = sqliteTable("auth_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: integer("window_start").notNull(),
  lockedUntil: integer("locked_until"),
});
