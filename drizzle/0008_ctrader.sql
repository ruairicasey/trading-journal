CREATE TABLE `ctrader_accounts` (
	`ctid` integer PRIMARY KEY NOT NULL,
	`connection_id` text,
	`account_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_live` integer NOT NULL,
	`trader_login` integer,
	`broker` text,
	`currency` text,
	`money_digits` integer,
	`registered_at` integer,
	`deals_synced_to` integer,
	`last_synced_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `ctrader_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ctrader_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refreshing_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ctrader_deals` (
	`ctid` integer NOT NULL,
	`deal_id` integer NOT NULL,
	`position_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`symbol_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`status` integer NOT NULL,
	`volume` real NOT NULL,
	`price` real,
	`time` integer NOT NULL,
	`commission` real DEFAULT 0 NOT NULL,
	`base_to_usd` real,
	`close` text,
	`raw` text NOT NULL,
	PRIMARY KEY(`ctid`, `deal_id`)
);
--> statement-breakpoint
CREATE INDEX `ctrader_deals_position_idx` ON `ctrader_deals` (`ctid`,`position_id`);