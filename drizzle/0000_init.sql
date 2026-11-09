CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'crypto' NOT NULL,
	`starting_balance` real DEFAULT 0 NOT NULL,
	`standard_risk_pct` real DEFAULT 1 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fills` (
	`wallet_id` text NOT NULL,
	`tid` integer NOT NULL,
	`coin` text NOT NULL,
	`dex` text DEFAULT '' NOT NULL,
	`market_type` text NOT NULL,
	`px` text NOT NULL,
	`sz` text NOT NULL,
	`side` text NOT NULL,
	`time` integer NOT NULL,
	`start_position` text NOT NULL,
	`dir` text NOT NULL,
	`closed_pnl` text NOT NULL,
	`fee` text NOT NULL,
	`fee_token` text NOT NULL,
	`builder_fee` text,
	`hash` text NOT NULL,
	`oid` integer NOT NULL,
	`crossed` integer NOT NULL,
	`liquidation` text,
	`twap_id` integer,
	`raw` text NOT NULL,
	`ingested_at` integer NOT NULL,
	PRIMARY KEY(`wallet_id`, `tid`),
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fills_wallet_coin_time_idx` ON `fills` (`wallet_id`,`coin`,`time`);--> statement-breakpoint
CREATE INDEX `fills_wallet_time_idx` ON `fills` (`wallet_id`,`time`);--> statement-breakpoint
CREATE TABLE `funding_events` (
	`wallet_id` text NOT NULL,
	`hash` text NOT NULL,
	`coin` text NOT NULL,
	`time` integer NOT NULL,
	`usdc` text NOT NULL,
	`szi` text NOT NULL,
	`funding_rate` text NOT NULL,
	`trade_id` text,
	PRIMARY KEY(`wallet_id`, `hash`, `coin`),
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `funding_wallet_coin_time_idx` ON `funding_events` (`wallet_id`,`coin`,`time`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`date` integer NOT NULL,
	`title` text,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notes_account_date_idx` ON `notes` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `saved_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `screenshots` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text,
	`note_id` text,
	`storage_key` text NOT NULL,
	`source_url` text,
	`caption` text,
	`width` integer,
	`height` integer,
	`bytes` integer,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `screenshots_trade_idx` ON `screenshots` (`trade_id`,`sort`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stop_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`time` integer NOT NULL,
	`price` real NOT NULL,
	`note` text,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_id` text NOT NULL,
	`trigger` text NOT NULL,
	`range_start` integer,
	`range_end` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`fills_fetched` integer DEFAULT 0 NOT NULL,
	`fills_new` integer DEFAULT 0 NOT NULL,
	`trades_touched` integer DEFAULT 0 NOT NULL,
	`gaps_detected` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT true NOT NULL,
	`error` text,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sync_runs_wallet_started_idx` ON `sync_runs` (`wallet_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_uq` ON `tags` (lower("name"));--> statement-breakpoint
CREATE TABLE `trade_fills` (
	`trade_id` text NOT NULL,
	`wallet_id` text NOT NULL,
	`tid` integer NOT NULL,
	`role` text NOT NULL,
	`sz` real NOT NULL,
	`px` real NOT NULL,
	`fee` real NOT NULL,
	`closed_pnl` real NOT NULL,
	`time` integer NOT NULL,
	PRIMARY KEY(`trade_id`, `wallet_id`, `tid`, `role`),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trade_fills_fill_idx` ON `trade_fills` (`wallet_id`,`tid`);--> statement-breakpoint
CREATE TABLE `trade_journal` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`strategy_id` text,
	`stop_loss` real,
	`take_profit` real,
	`size_mode` text DEFAULT 'position' NOT NULL,
	`planned_risk_usd` real,
	`leverage_override` real,
	`session` text,
	`trade_type` text,
	`fee_override` real,
	`entry_timeframe` text,
	`timeframe_class` text,
	`market_condition` text,
	`htf_timeframes` text DEFAULT '[]' NOT NULL,
	`emotion_before_id` text,
	`grade` text,
	`entry_retests` integer,
	`max_r_reached` real,
	`risk_multiplier` real,
	`rationale` text,
	`post_notes` text,
	`reflection` text DEFAULT '{}' NOT NULL,
	`rules_followed` text,
	`exit_reason_id` text,
	`emotion_after_id` text,
	`process_compliant` integer,
	`manual_entry` real,
	`manual_exit` real,
	`manual_size` real,
	`manual_entry_time` integer,
	`manual_exit_time` integer,
	`reviewed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`strategy_id`) REFERENCES `vocab_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`emotion_before_id`) REFERENCES `vocab_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exit_reason_id`) REFERENCES `vocab_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`emotion_after_id`) REFERENCES `vocab_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trade_partials` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`kind` text NOT NULL,
	`price` real NOT NULL,
	`size_units` real,
	`pct` real,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trade_tags` (
	`trade_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`trade_id`, `tag_id`),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trade_vocab` (
	`trade_id` text NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`trade_id`, `item_id`),
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `vocab_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trade_vocab_item_idx` ON `trade_vocab` (`item_id`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`wallet_id` text,
	`source` text NOT NULL,
	`external_key` text,
	`coin` text NOT NULL,
	`display_pair` text NOT NULL,
	`dex` text DEFAULT '' NOT NULL,
	`market_type` text DEFAULT 'perp' NOT NULL,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`avg_entry` real,
	`avg_exit` real,
	`size_units` real,
	`entry_units_total` real,
	`exit_units_total` real,
	`notional_usd` real,
	`gross_pnl` real,
	`fees` real,
	`funding` real DEFAULT 0 NOT NULL,
	`net_pnl` real,
	`return_pct` real,
	`entry_time` integer,
	`exit_time` integer,
	`duration_ms` integer,
	`fill_count` integer DEFAULT 0 NOT NULL,
	`leverage` real,
	`liq_px` real,
	`flags` text DEFAULT '{}' NOT NULL,
	`reconstructed_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trades_external_key_uq` ON `trades` (`external_key`);--> statement-breakpoint
CREATE INDEX `trades_account_entry_idx` ON `trades` (`account_id`,`entry_time`);--> statement-breakpoint
CREATE INDEX `trades_account_status_idx` ON `trades` (`account_id`,`status`);--> statement-breakpoint
CREATE TABLE `vocab_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`is_custom` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vocab_categories_kind_idx` ON `vocab_categories` (`kind`,`sort`);--> statement-breakpoint
CREATE TABLE `vocab_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`category_id` text,
	`label` text NOT NULL,
	`description` text,
	`favorite` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `vocab_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `vocab_items_kind_idx` ON `vocab_items` (`kind`,`category_id`,`sort`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`address` text NOT NULL,
	`label` text DEFAULT 'Main' NOT NULL,
	`kind` text DEFAULT 'main' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`auto_sync` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_fill_time` integer,
	`oldest_fill_time` integer,
	`backfill_cursor` integer,
	`backfill_completed_at` integer,
	`last_synced_at` integer,
	`last_success_at` integer,
	`history_truncated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_address_uq` ON `wallets` (`address`);