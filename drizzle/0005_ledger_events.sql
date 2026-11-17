CREATE TABLE `ledger_events` (
	`wallet_id` text NOT NULL,
	`uid` text NOT NULL,
	`time` integer NOT NULL,
	`hash` text NOT NULL,
	`type` text NOT NULL,
	`delta` text NOT NULL,
	`kind` text NOT NULL,
	`usd` real NOT NULL,
	PRIMARY KEY(`wallet_id`, `uid`),
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_wallet_time_idx` ON `ledger_events` (`wallet_id`,`time`);--> statement-breakpoint
ALTER TABLE `wallets` ADD `last_ledger_time` integer;--> statement-breakpoint
ALTER TABLE `wallets` ADD `account_mode` text;