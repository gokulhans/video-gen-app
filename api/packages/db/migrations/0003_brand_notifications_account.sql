ALTER TABLE `brands` ADD `current_version_id` text;
ALTER TABLE `brands` ADD `archived_at` integer;

CREATE TABLE `brand_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`logo_asset_key` text,
	`primary_color` text,
	`secondary_color` text,
	`font` text,
	`phone` text,
	`website` text,
	`watermark` integer DEFAULT true NOT NULL,
	`logo_position` text DEFAULT 'top_right' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `brand_versions_brand_version_unique` ON `brand_versions` (`brand_id`,`version`);
CREATE INDEX `brand_versions_tenant_created_idx` ON `brand_versions` (`user_id`,`created_at`);

CREATE TABLE `brand_mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`brand_id` text NOT NULL,
	`brand_version_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_version_id`) REFERENCES `brand_versions`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `brand_mutations_tenant_key_unique` ON `brand_mutations` (`user_id`,`idempotency_key`);

INSERT INTO `brand_versions`
	(`id`,`brand_id`,`user_id`,`version`,`name`,`logo_asset_key`,`primary_color`,`secondary_color`,`font`,`phone`,`website`,`watermark`,`logo_position`,`created_at`)
SELECT 'brandver_legacy_' || id,id,user_id,1,name,
	CASE WHEN logo_url LIKE '/assets/%' THEN substr(logo_url,9) ELSE NULL END,
	primary_color,secondary_color,font,phone,website,watermark,logo_position,created_at
FROM `brands`;
UPDATE `brands` SET `current_version_id`='brandver_legacy_' || id WHERE `current_version_id` IS NULL;

ALTER TABLE `notifications` ADD `job_id` text;
ALTER TABLE `notifications` ADD `deep_link` text;
ALTER TABLE `notifications` ADD `read_at` integer;
ALTER TABLE `notifications` ADD `dedupe_key` text;
ALTER TABLE `notifications` ADD `metadata` text;
CREATE UNIQUE INDEX `notifications_tenant_dedupe_unique` ON `notifications` (`user_id`,`dedupe_key`);
CREATE INDEX `notifications_tenant_unread_idx` ON `notifications` (`user_id`,`is_read`,`created_at`);
CREATE INDEX `notifications_tenant_cursor_idx` ON `notifications` (`user_id`,`created_at`,`id`);

CREATE TABLE `notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`push_enabled` integer DEFAULT true NOT NULL,
	`email_enabled` integer DEFAULT false NOT NULL,
	`generation_updates` integer DEFAULT true NOT NULL,
	`render_updates` integer DEFAULT true NOT NULL,
	`product_updates` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

ALTER TABLE `devices` ADD `disabled_at` integer;
ALTER TABLE `devices` ADD `updated_at` integer;
UPDATE `devices` SET `updated_at`=`last_seen_at` WHERE `updated_at` IS NULL;
CREATE INDEX `devices_tenant_active_idx` ON `devices` (`user_id`,`disabled_at`,`last_seen_at`);

CREATE TABLE `data_export_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`idempotency_key` text NOT NULL,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`expires_at` integer,
	`object_key` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `data_export_requests_tenant_idempotency_unique` ON `data_export_requests` (`user_id`,`idempotency_key`);
CREATE INDEX `data_export_requests_tenant_status_idx` ON `data_export_requests` (`user_id`,`status`,`requested_at`);

CREATE TABLE `account_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'awaiting_reauthentication' NOT NULL,
	`idempotency_key` text NOT NULL,
	`requested_at` integer NOT NULL,
	`reauthenticated_at` integer,
	`scheduled_for` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `account_deletion_requests_tenant_idempotency_unique` ON `account_deletion_requests` (`user_id`,`idempotency_key`);
CREATE INDEX `account_deletion_requests_tenant_status_idx` ON `account_deletion_requests` (`user_id`,`status`,`requested_at`);
