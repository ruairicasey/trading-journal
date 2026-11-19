ALTER TABLE `ctrader_accounts` ADD `created_account_id` text;--> statement-breakpoint
ALTER TABLE `ctrader_accounts` ADD `starting_balance_pending` integer DEFAULT false NOT NULL;