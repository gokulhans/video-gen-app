ALTER TABLE `brand_mutations` ADD `action` text;
ALTER TABLE `brand_mutations` ADD `target_id` text;
ALTER TABLE `brand_mutations` ADD `request_fingerprint` text;
ALTER TABLE `brand_mutations` ADD `response_snapshot` text;

CREATE TABLE `asset_cleanup_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`bucket` text NOT NULL,
	`object_key` text NOT NULL,
	`upload_asset_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `asset_cleanup_outbox_object_unique` ON `asset_cleanup_outbox` (`bucket`,`object_key`,`kind`);
CREATE INDEX `asset_cleanup_outbox_retry_idx` ON `asset_cleanup_outbox` (`status`,`next_attempt_at`);

ALTER TABLE `data_export_requests` ADD `workflow_instance_id` text;
ALTER TABLE `data_export_requests` ADD `error_code` text;

ALTER TABLE `account_deletion_requests` ADD `workflow_instance_id` text;
ALTER TABLE `account_deletion_requests` ADD `confirmed_session_id` text;
ALTER TABLE `account_deletion_requests` ADD `completed_at` integer;
ALTER TABLE `account_deletion_requests` ADD `error_code` text;

CREATE TABLE `account_deletion_tombstones` (
	`request_id` text PRIMARY KEY NOT NULL,
	`pseudonymous_user_hash` text NOT NULL,
	`workflow_instance_id` text,
	`asset_counts` text NOT NULL,
	`deleted_at` integer NOT NULL
);
CREATE INDEX `account_deletion_tombstones_deleted_idx` ON `account_deletion_tombstones` (`deleted_at`);
