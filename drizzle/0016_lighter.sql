CREATE TABLE `lighter_state` (
	`wallet_id` text PRIMARY KEY NOT NULL,
	`token_enc` text,
	`token_expires_at` integer,
	`fills_through` integer,
	`fills_cursor` text,
	`pass_through` integer,
	`orders_through` integer,
	`orders_cursor` text,
	`orders_pass_since` integer,
	`orders_pass_start` integer,
	`reconciled_at` integer,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP INDEX `wallets_address_uq`;--> statement-breakpoint
ALTER TABLE `wallets` ADD `exchange` text DEFAULT 'hyperliquid' NOT NULL;--> statement-breakpoint
ALTER TABLE `wallets` ADD `account_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_exchange_address_uq` ON `wallets` (`exchange`,`address`,`account_index`);