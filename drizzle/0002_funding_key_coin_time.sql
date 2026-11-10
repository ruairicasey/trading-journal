PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_funding_events` (
	`wallet_id` text NOT NULL,
	`hash` text NOT NULL,
	`coin` text NOT NULL,
	`time` integer NOT NULL,
	`usdc` text NOT NULL,
	`szi` text NOT NULL,
	`funding_rate` text NOT NULL,
	`trade_id` text,
	PRIMARY KEY(`wallet_id`, `coin`, `time`),
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_funding_events`("wallet_id", "hash", "coin", "time", "usdc", "szi", "funding_rate", "trade_id") SELECT "wallet_id", "hash", "coin", "time", "usdc", "szi", "funding_rate", "trade_id" FROM `funding_events`;--> statement-breakpoint
DROP TABLE `funding_events`;--> statement-breakpoint
ALTER TABLE `__new_funding_events` RENAME TO `funding_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Funding rows were previously deduped on the (all-zero) hash and mostly dropped: re-fetch funding from scratch.
UPDATE `wallets` SET `last_funding_time` = NULL;
