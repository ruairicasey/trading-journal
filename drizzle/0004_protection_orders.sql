CREATE TABLE `orders` (
	`wallet_id` text NOT NULL,
	`oid` integer NOT NULL,
	`coin` text NOT NULL,
	`side` text NOT NULL,
	`order_type` text NOT NULL,
	`is_trigger` integer NOT NULL,
	`trigger_px` real,
	`trigger_condition` text,
	`limit_px` real,
	`reduce_only` integer NOT NULL,
	`is_position_tpsl` integer NOT NULL,
	`orig_sz` real,
	`placed_at` integer NOT NULL,
	`status` text NOT NULL,
	`status_at` integer NOT NULL,
	`ended_at` integer,
	`raw` text NOT NULL,
	PRIMARY KEY(`wallet_id`, `oid`),
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orders_wallet_coin_placed_idx` ON `orders` (`wallet_id`,`coin`,`placed_at`);--> statement-breakpoint
ALTER TABLE `stop_moves` ADD `source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `stop_moves` ADD `oid` integer;--> statement-breakpoint
ALTER TABLE `trade_journal` ADD `stop_loss_source` text;--> statement-breakpoint
ALTER TABLE `trade_journal` ADD `take_profit_source` text;--> statement-breakpoint
ALTER TABLE `trade_journal` ADD `tp_partials_source` text;--> statement-breakpoint
-- Values that existed before auto-detection were typed by the user: mark them so sync never overwrites them.
UPDATE `trade_journal` SET `stop_loss_source` = 'user' WHERE `stop_loss` IS NOT NULL;--> statement-breakpoint
UPDATE `trade_journal` SET `take_profit_source` = 'user' WHERE `take_profit` IS NOT NULL;--> statement-breakpoint
UPDATE `trade_journal` SET `tp_partials_source` = 'user' WHERE `trade_id` IN (SELECT `trade_id` FROM `trade_partials` WHERE `kind` = 'tp');
