-- Additive production foundation for the versioned catalog and generation platform.
-- Published/versioned rows are immutable by application policy; historical rows are never rewritten.

CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`cover_asset_key` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);
CREATE INDEX `categories_active_sort_idx` ON `categories` (`is_active`, `sort_order`);

CREATE TABLE `pricing_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`price_key` text NOT NULL,
	`version` integer NOT NULL,
	`credit_amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`estimated_cost_micros` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `pricing_versions_key_version_unique` ON `pricing_versions` (`price_key`, `version`);
CREATE INDEX `pricing_versions_status_idx` ON `pricing_versions` (`status`, `created_at`);

CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`public_config` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `providers_key_unique` ON `providers` (`provider_key`);

CREATE TABLE `provider_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_key` text NOT NULL,
	`name` text NOT NULL,
	`modality` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX `provider_models_provider_key_unique` ON `provider_models` (`provider_id`, `model_key`);
CREATE INDEX `provider_models_active_idx` ON `provider_models` (`provider_id`, `is_active`);

CREATE TABLE `provider_model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_model_id` text NOT NULL,
	`version` integer NOT NULL,
	`provider_version_ref` text NOT NULL,
	`capabilities` text NOT NULL,
	`cost_config` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`provider_model_id`) REFERENCES `provider_models`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX `provider_model_versions_version_unique` ON `provider_model_versions` (`provider_model_id`, `version`);
CREATE UNIQUE INDEX `provider_model_versions_ref_unique` ON `provider_model_versions` (`provider_model_id`, `provider_version_ref`);
CREATE INDEX `provider_model_versions_status_idx` ON `provider_model_versions` (`status`, `created_at`);

ALTER TABLE `templates` ADD `slug` text;
ALTER TABLE `templates` ADD `lifecycle_status` text DEFAULT 'active' NOT NULL;
ALTER TABLE `templates` ADD `current_version_id` text;
UPDATE `templates` SET `slug` = `id` WHERE `slug` IS NULL;
CREATE UNIQUE INDEX `templates_slug_unique` ON `templates` (`slug`);
CREATE INDEX `templates_lifecycle_idx` ON `templates` (`lifecycle_status`, `updated_at`);

CREATE TABLE `template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`preview_asset_key` text,
	`pipeline_type` text NOT NULL,
	`input_schema_version` integer DEFAULT 1 NOT NULL,
	`capabilities` text NOT NULL,
	`pricing_version_id` text,
	`config_snapshot` text NOT NULL,
	`published_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`pricing_version_id`) REFERENCES `pricing_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `template_versions_template_version_unique` ON `template_versions` (`template_id`, `version`);
CREATE INDEX `template_versions_status_idx` ON `template_versions` (`status`, `published_at`);

CREATE TABLE `template_category_links` (
	`template_id` text NOT NULL,
	`category_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`template_id`, `category_id`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `template_category_links_category_sort_idx` ON `template_category_links` (`category_id`, `sort_order`);

CREATE TABLE `template_input_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_version_id` text NOT NULL,
	`field_key` text NOT NULL,
	`field_type` text NOT NULL,
	`label` text NOT NULL,
	`help_text` text,
	`is_required` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`constraints` text,
	`options` text,
	`visibility_rule` text,
	FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `template_input_definitions_field_unique` ON `template_input_definitions` (`template_version_id`, `field_key`);
CREATE INDEX `template_input_definitions_sort_idx` ON `template_input_definitions` (`template_version_id`, `sort_order`);

CREATE TABLE `template_pipeline_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`template_version_id` text NOT NULL,
	`provider_model_version_id` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`rollout_percent` integer DEFAULT 100 NOT NULL,
	`input_mapping` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_model_version_id`) REFERENCES `provider_model_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX `template_pipeline_bindings_model_unique` ON `template_pipeline_bindings` (`template_version_id`, `provider_model_version_id`);
CREATE INDEX `template_pipeline_bindings_route_idx` ON `template_pipeline_bindings` (`template_version_id`, `is_active`, `priority`);

CREATE TABLE `voices` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`locale` text NOT NULL,
	`style` text,
	`sample_asset_key` text,
	`tags` text,
	`is_premium` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `voices_slug_unique` ON `voices` (`slug`);
CREATE INDEX `voices_catalog_idx` ON `voices` (`is_active`, `locale`, `sort_order`);

CREATE TABLE `voice_provider_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`voice_id` text NOT NULL,
	`provider_model_version_id` text NOT NULL,
	`provider_voice_ref` text NOT NULL,
	`config` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`voice_id`) REFERENCES `voices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_model_version_id`) REFERENCES `provider_model_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX `voice_provider_bindings_unique` ON `voice_provider_bindings` (`voice_id`, `provider_model_version_id`);

CREATE TABLE `voice_favorites` (
	`user_id` text NOT NULL,
	`voice_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`user_id`, `voice_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voice_id`) REFERENCES `voices`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `voice_favorites_user_created_idx` ON `voice_favorites` (`user_id`, `created_at`);

CREATE TABLE `stock_characters` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`preview_asset_key` text NOT NULL,
	`tags` text,
	`consent_status` text NOT NULL,
	`license_expires_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `stock_characters_slug_unique` ON `stock_characters` (`slug`);
CREATE INDEX `stock_characters_catalog_idx` ON `stock_characters` (`is_active`, `created_at`);

CREATE TABLE `stock_character_provider_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_character_id` text NOT NULL,
	`provider_model_version_id` text NOT NULL,
	`provider_character_ref` text NOT NULL,
	`config` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`stock_character_id`) REFERENCES `stock_characters`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_model_version_id`) REFERENCES `provider_model_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX `stock_character_provider_bindings_unique` ON `stock_character_provider_bindings` (`stock_character_id`, `provider_model_version_id`);

CREATE TABLE `user_characters` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `user_characters_tenant_status_idx` ON `user_characters` (`user_id`, `status`, `updated_at`);

CREATE TABLE `user_character_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_character_id` text NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`source_asset_key` text NOT NULL,
	`preview_asset_key` text,
	`consent_record` text NOT NULL,
	`provider_refs` text,
	`moderation_result` text,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	FOREIGN KEY (`user_character_id`) REFERENCES `user_characters`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `user_character_versions_version_unique` ON `user_character_versions` (`user_character_id`, `version`);
CREATE INDEX `user_character_versions_tenant_status_idx` ON `user_character_versions` (`user_id`, `status`, `created_at`);

CREATE TABLE `user_upload_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`declared_size` integer NOT NULL,
	`actual_size` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finalized_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `user_upload_assets_object_unique` ON `user_upload_assets` (`object_key`);
CREATE INDEX `user_upload_assets_tenant_status_idx` ON `user_upload_assets` (`user_id`, `status`, `created_at`);

CREATE TABLE `generation_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `generation_quotes_tenant_expiry_idx` ON `generation_quotes` (`user_id`, `expires_at`);

CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`template_id` text NOT NULL,
	`template_version_id` text NOT NULL,
	`pricing_version_id` text NOT NULL,
	`voice_id` text,
	`stock_character_id` text,
	`user_character_version_id` text,
	`idempotency_key` text NOT NULL,
	`request_id` text NOT NULL,
	`workflow_instance_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`normalized_inputs` text NOT NULL,
	`configuration_snapshot` text NOT NULL,
	`quoted_credits` integer NOT NULL,
	`estimated_cost_micros` integer DEFAULT 0 NOT NULL,
	`actual_cost_micros` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`pricing_version_id`) REFERENCES `pricing_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`voice_id`) REFERENCES `voices`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stock_character_id`) REFERENCES `stock_characters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_character_version_id`) REFERENCES `user_character_versions`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `generation_jobs_tenant_idempotency_unique` ON `generation_jobs` (`user_id`, `idempotency_key`);
CREATE INDEX `generation_jobs_tenant_history_idx` ON `generation_jobs` (`user_id`, `created_at` DESC, `id` DESC);
CREATE INDEX `generation_jobs_tenant_status_idx` ON `generation_jobs` (`user_id`, `status`, `updated_at`);
CREATE UNIQUE INDEX `generation_jobs_workflow_unique` ON `generation_jobs` (`workflow_instance_id`);
CREATE INDEX `generation_jobs_request_idx` ON `generation_jobs` (`request_id`);

CREATE TABLE `generation_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`provider_id` text NOT NULL,
	`provider_model_version_id` text NOT NULL,
	`provider_job_id` text,
	`status` text DEFAULT 'created' NOT NULL,
	`request_metadata` text,
	`response_metadata` text,
	`error_class` text,
	`error_code` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_model_version_id`) REFERENCES `provider_model_versions`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX `generation_attempts_job_number_unique` ON `generation_attempts` (`job_id`, `attempt_number`);
CREATE UNIQUE INDEX `generation_attempts_provider_job_unique` ON `generation_attempts` (`provider_id`, `provider_job_id`);
CREATE INDEX `generation_attempts_job_status_idx` ON `generation_attempts` (`job_id`, `status`);

CREATE TABLE `generation_job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt_id` text,
	`provider_id` text,
	`provider_event_id` text,
	`operation_key` text NOT NULL,
	`source` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `generation_attempts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX `generation_job_events_operation_unique` ON `generation_job_events` (`job_id`, `operation_key`);
CREATE UNIQUE INDEX `generation_job_events_provider_event_unique` ON `generation_job_events` (`provider_id`, `provider_event_id`);
CREATE INDEX `generation_job_events_timeline_idx` ON `generation_job_events` (`job_id`, `created_at`, `id`);

CREATE TABLE `generation_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt_id` text,
	`kind` text NOT NULL,
	`storage` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text,
	`byte_size` integer,
	`checksum` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `generation_attempts`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `generation_assets_object_unique` ON `generation_assets` (`storage`, `object_key`);
CREATE INDEX `generation_assets_job_kind_idx` ON `generation_assets` (`job_id`, `kind`, `created_at`);

CREATE TABLE `credit_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`operation_key` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`reserve_transaction_id` text,
	`settlement_transaction_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reserve_transaction_id`) REFERENCES `token_transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`settlement_transaction_id`) REFERENCES `token_transactions`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `credit_reservations_tenant_operation_unique` ON `credit_reservations` (`user_id`, `operation_key`);
CREATE UNIQUE INDEX `credit_reservations_job_unique` ON `credit_reservations` (`job_id`);
CREATE INDEX `credit_reservations_reconcile_idx` ON `credit_reservations` (`status`, `expires_at`);

CREATE TABLE `admin_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`role_key` text NOT NULL,
	`name` text NOT NULL,
	`permissions` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `admin_roles_key_unique` ON `admin_roles` (`role_key`);

CREATE TABLE `admin_user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`granted_by` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `admin_roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE TABLE `admin_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`request_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`reason` text,
	`before_summary` text,
	`after_summary` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `admin_audit_events_timeline_idx` ON `admin_audit_events` (`created_at` DESC, `id` DESC);
CREATE INDEX `admin_audit_events_actor_idx` ON `admin_audit_events` (`actor_user_id`, `created_at` DESC);
CREATE INDEX `admin_audit_events_target_idx` ON `admin_audit_events` (`target_type`, `target_id`, `created_at` DESC);

-- Preserve the legacy template catalog while making it discoverable through categories.
INSERT OR IGNORE INTO `categories` (`id`, `slug`, `name`, `sort_order`, `is_active`, `created_at`, `updated_at`)
SELECT 'cat_' || `vertical`, `vertical`, replace(`vertical`, '_', ' '), 0, 1, unixepoch() * 1000, unixepoch() * 1000
FROM `templates`;

INSERT OR IGNORE INTO `template_category_links` (`template_id`, `category_id`, `sort_order`, `created_at`)
SELECT `id`, 'cat_' || `vertical`, 0, unixepoch() * 1000 FROM `templates`;
