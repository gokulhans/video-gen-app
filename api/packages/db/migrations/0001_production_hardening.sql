ALTER TABLE `projects` ADD `generation_request_key` text;
ALTER TABLE `projects` ADD `generation_params` text;
ALTER TABLE `projects` ADD `generation_stage` text DEFAULT 'script';
ALTER TABLE `projects` ADD `generation_progress` integer DEFAULT 0;
ALTER TABLE `projects` ADD `generation_error` text;
CREATE UNIQUE INDEX `projects_generation_request_key_unique` ON `projects` (`generation_request_key`);

ALTER TABLE `brands` ADD `logo_position` text NOT NULL DEFAULT 'top_right';

ALTER TABLE `token_transactions` ADD `operation_key` text;
CREATE UNIQUE INDEX `token_transactions_operation_key_unique` ON `token_transactions` (`operation_key`);

ALTER TABLE `render_jobs` ADD `idempotency_key` text;
ALTER TABLE `render_jobs` ADD `charged_tokens` integer NOT NULL DEFAULT 0;
ALTER TABLE `render_jobs` ADD `refunded_at` integer;
CREATE UNIQUE INDEX `render_jobs_idempotency_key_unique` ON `render_jobs` (`idempotency_key`);

CREATE TABLE `play_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`purchase_token_hash` text NOT NULL,
	`order_id` text,
	`token_amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `play_purchases_purchase_token_hash_unique` ON `play_purchases` (`purchase_token_hash`);

CREATE INDEX `projects_user_updated_idx` ON `projects` (`user_id`, `updated_at` DESC);
CREATE INDEX `brands_user_updated_idx` ON `brands` (`user_id`, `updated_at` DESC);
CREATE INDEX `token_transactions_user_created_idx` ON `token_transactions` (`user_id`, `created_at` DESC);
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`, `created_at` DESC);
CREATE INDEX `render_jobs_user_status_updated_idx` ON `render_jobs` (`user_id`, `status`, `updated_at`);
CREATE INDEX `devices_user_idx` ON `devices` (`user_id`);
