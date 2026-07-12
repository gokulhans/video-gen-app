ALTER TABLE `user_upload_assets` ADD `purpose` text;
ALTER TABLE `user_upload_assets` ADD `cleanup_after` integer;
CREATE INDEX `user_upload_assets_cleanup_idx` ON `user_upload_assets` (`purpose`,`cleanup_after`,`status`);

CREATE TABLE `character_mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`response_snapshot` text NOT NULL,
	`asset_id` text NOT NULL,
	`character_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `user_upload_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`character_id`) REFERENCES `user_characters`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `character_mutations_tenant_key_unique` ON `character_mutations` (`user_id`,`idempotency_key`);
CREATE UNIQUE INDEX `character_mutations_asset_unique` ON `character_mutations` (`asset_id`);
CREATE UNIQUE INDEX `user_character_versions_source_unique` ON `user_character_versions` (`source_asset_key`);
