ALTER TABLE `accounts` ADD `daily_loss_limit` real;--> statement-breakpoint
ALTER TABLE `accounts` ADD `max_trades_per_day` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `max_loss_streak` integer;