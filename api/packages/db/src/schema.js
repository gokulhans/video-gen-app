import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

const now = () => Date.now();
const ts = (name) => integer(name); // unix ms (product tables — our code writes numbers)
// better-auth writes JS Date objects; timestamp_ms serializes them to unix ms
// so the stored representation is identical to ts() columns.
const tsDate = (name) => integer(name, { mode: "timestamp_ms" });
const nowDate = () => new Date();

// ---------- better-auth core ----------
export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
	image: text("image"),
	phone: text("phone"),
	tokens: integer("tokens").notNull().default(600),
	isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
	createdAt: tsDate("created_at").notNull().$defaultFn(nowDate),
	updatedAt: tsDate("updated_at").notNull().$defaultFn(nowDate),
});

export const session = sqliteTable("session", {
	id: text("id").primaryKey(),
	expiresAt: tsDate("expires_at").notNull(),
	token: text("token").notNull().unique(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	createdAt: tsDate("created_at").notNull().$defaultFn(nowDate),
	updatedAt: tsDate("updated_at").notNull().$defaultFn(nowDate),
});

export const account = sqliteTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: tsDate("access_token_expires_at"),
	refreshTokenExpiresAt: tsDate("refresh_token_expires_at"),
	scope: text("scope"),
	password: text("password"),
	createdAt: tsDate("created_at").notNull().$defaultFn(nowDate),
	updatedAt: tsDate("updated_at").notNull().$defaultFn(nowDate),
});

export const verification = sqliteTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: tsDate("expires_at").notNull(),
	createdAt: tsDate("created_at").$defaultFn(nowDate),
	updatedAt: tsDate("updated_at").$defaultFn(nowDate),
});

// ---------- product ----------
export const projects = sqliteTable("projects", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	script: text("script"),
	currentStep: integer("current_step").default(1),
	ratio: text("ratio"),
	length: text("length"),
	language: text("language"),
	voice: text("voice"),
	voiceoverUrl: text("voiceover_url"),
	timestamps: text("timestamps", { mode: "json" }),
	scenes: text("scenes", { mode: "json" }),
	composition: text("composition", { mode: "json" }),
	captionConfig: text("caption_config", { mode: "json" }),
	templateId: text("template_id"),
	brandId: text("brand_id"),
	schemaVersion: integer("schema_version").notNull().default(1),
	generationStatus: text("generation_status").default("idle"), // idle|running|failed|complete
	workflowInstanceId: text("workflow_instance_id"),
	generationRequestKey: text("generation_request_key").unique(),
	generationParams: text("generation_params", { mode: "json" }),
	generationStage: text("generation_stage").default("script"),
	generationProgress: integer("generation_progress").default(0),
	generationError: text("generation_error"),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
});

export const brands = sqliteTable("brands", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	logoUrl: text("logo_url"),
	primaryColor: text("primary_color"),
	secondaryColor: text("secondary_color"),
	font: text("font"),
	phone: text("phone"),
	website: text("website"),
	watermark: integer("watermark", { mode: "boolean" }).notNull().default(true),
	logoPosition: text("logo_position").notNull().default("top_right"),
	currentVersionId: text("current_version_id"),
	archivedAt: ts("archived_at"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
});

export const templates = sqliteTable("templates", {
	id: text("id").primaryKey(),
	slug: text("slug"),
	vertical: text("vertical").notNull(), // restaurant|salon|real_estate|...
	name: text("name").notNull(),
	previewVideoUrl: text("preview_video_url"),
	scriptPromptPreset: text("script_prompt_preset").notNull(),
	imageStylePreset: text("image_style_preset").notNull(),
	musicTrackUrl: text("music_track_url"),
	captionStyle: text("caption_style", { mode: "json" }),
	defaultDuration: integer("default_duration").notNull().default(45),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	lifecycleStatus: text("lifecycle_status").notNull().default("active"),
	currentVersionId: text("current_version_id"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("templates_slug_unique").on(table.slug),
	index("templates_lifecycle_idx").on(table.lifecycleStatus, table.updatedAt),
]);

export const tokenTransactions = sqliteTable("token_transactions", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	amount: integer("amount").notNull(), // + credit, - debit
	type: text("type").notNull(), // signup_bonus|purchase|script_generation|voice_generation|image_generation|render|refund|admin_grant
	description: text("description").notNull(),
	projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
	operationKey: text("operation_key").unique(),
	createdAt: ts("created_at").notNull().$defaultFn(now),
});

export const tokenCosts = sqliteTable("token_costs", {
	id: text("id").primaryKey(),
	action: text("action").notNull().unique(),
	cost: integer("cost").notNull(),
	description: text("description").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
});

export const notifications = sqliteTable("notifications", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	type: text("type").notNull(), // render_complete|render_failed|generation_complete|system
	title: text("title").notNull(),
	message: text("message").notNull(),
	projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
	projectName: text("project_name"),
	downloadUrl: text("download_url"),
	isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
	pushSent: integer("push_sent", { mode: "boolean" }).notNull().default(false),
	emailSent: integer("email_sent", { mode: "boolean" }).notNull().default(false),
	jobId: text("job_id"),
	deepLink: text("deep_link"),
	readAt: ts("read_at"),
	dedupeKey: text("dedupe_key"),
	metadata: text("metadata", { mode: "json" }),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("notifications_tenant_dedupe_unique").on(table.userId, table.dedupeKey),
	index("notifications_tenant_unread_idx").on(table.userId, table.isRead, table.createdAt),
	index("notifications_tenant_cursor_idx").on(table.userId, table.createdAt, table.id),
]);

export const notificationPreferences = sqliteTable("notification_preferences", {
	userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
	pushEnabled: integer("push_enabled", { mode: "boolean" }).notNull().default(true),
	emailEnabled: integer("email_enabled", { mode: "boolean" }).notNull().default(false),
	generationUpdates: integer("generation_updates", { mode: "boolean" }).notNull().default(true),
	renderUpdates: integer("render_updates", { mode: "boolean" }).notNull().default(true),
	productUpdates: integer("product_updates", { mode: "boolean" }).notNull().default(false),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
});

export const renderJobs = sqliteTable("render_jobs", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
	resolution: text("resolution").notNull().default("720p"),
	status: text("status").notNull().default("queued"), // queued|rendering|completed|failed
	videoUrl: text("video_url"),
	progress: integer("progress").notNull().default(0),
	error: text("error"),
	idempotencyKey: text("idempotency_key").unique(),
	chargedTokens: integer("charged_tokens").notNull().default(0),
	refundedAt: ts("refunded_at"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
});

export const brandVersions = sqliteTable("brand_versions", {
	id: text("id").primaryKey(),
	brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	version: integer("version").notNull(),
	name: text("name").notNull(),
	logoAssetKey: text("logo_asset_key"),
	primaryColor: text("primary_color"),
	secondaryColor: text("secondary_color"),
	font: text("font"),
	phone: text("phone"),
	website: text("website"),
	watermark: integer("watermark", { mode: "boolean" }).notNull().default(true),
	logoPosition: text("logo_position").notNull().default("top_right"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("brand_versions_brand_version_unique").on(table.brandId, table.version),
	index("brand_versions_tenant_created_idx").on(table.userId, table.createdAt),
]);

export const brandMutations = sqliteTable("brand_mutations", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	idempotencyKey: text("idempotency_key").notNull(),
	brandId: text("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
	brandVersionId: text("brand_version_id").references(() => brandVersions.id, { onDelete: "set null" }),
	action: text("action"),
	targetId: text("target_id"),
	requestFingerprint: text("request_fingerprint"),
	responseSnapshot: text("response_snapshot"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [uniqueIndex("brand_mutations_tenant_key_unique").on(table.userId, table.idempotencyKey)]);

export const playPurchases = sqliteTable("play_purchases", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	productId: text("product_id").notNull(),
	purchaseTokenHash: text("purchase_token_hash").notNull().unique(),
	orderId: text("order_id"),
	tokenAmount: integer("token_amount").notNull(),
	createdAt: ts("created_at").notNull().$defaultFn(now),
});

export const devices = sqliteTable("devices", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	fcmToken: text("fcm_token").notNull().unique(),
	platform: text("platform").notNull(), // android|ios
	lastSeenAt: ts("last_seen_at").notNull().$defaultFn(now),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	disabledAt: ts("disabled_at"),
	updatedAt: ts("updated_at"),
});

export const dataExportRequests = sqliteTable("data_export_requests", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	status: text("status").notNull().default("queued"),
	idempotencyKey: text("idempotency_key").notNull(),
	requestedAt: ts("requested_at").notNull().$defaultFn(now),
	completedAt: ts("completed_at"),
	expiresAt: ts("expires_at"),
	objectKey: text("object_key"),
	workflowInstanceId: text("workflow_instance_id"),
	errorCode: text("error_code"),
}, (table) => [
	uniqueIndex("data_export_requests_tenant_idempotency_unique").on(table.userId, table.idempotencyKey),
	index("data_export_requests_tenant_status_idx").on(table.userId, table.status, table.requestedAt),
]);

export const accountDeletionRequests = sqliteTable("account_deletion_requests", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	status: text("status").notNull().default("awaiting_reauthentication"),
	idempotencyKey: text("idempotency_key").notNull(),
	requestedAt: ts("requested_at").notNull().$defaultFn(now),
	reauthenticatedAt: ts("reauthenticated_at"),
	scheduledFor: ts("scheduled_for"),
	cancelledAt: ts("cancelled_at"),
	workflowInstanceId: text("workflow_instance_id"),
	confirmedSessionId: text("confirmed_session_id"),
	completedAt: ts("completed_at"),
	errorCode: text("error_code"),
}, (table) => [
	uniqueIndex("account_deletion_requests_tenant_idempotency_unique").on(table.userId, table.idempotencyKey),
	index("account_deletion_requests_tenant_status_idx").on(table.userId, table.status, table.requestedAt),
]);

export const settings = sqliteTable("settings", {
	id: text("id").primaryKey().default("system"),
	defaultSignupBonus: integer("default_signup_bonus").notNull().default(600),
	minimumTokenBalance: integer("minimum_token_balance").notNull().default(50),
	enableTokenSystem: integer("enable_token_system", { mode: "boolean" }).notNull().default(true),
	enableSignupBonus: integer("enable_signup_bonus", { mode: "boolean" }).notNull().default(true),
	maxTokensPerUser: integer("max_tokens_per_user").notNull().default(100000),
	tokenExpirationDays: integer("token_expiration_days").notNull().default(0),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
});

export const assetCleanupOutbox = sqliteTable("asset_cleanup_outbox", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	kind: text("kind").notNull(),
	bucket: text("bucket").notNull(),
	objectKey: text("object_key").notNull(),
	uploadAssetId: text("upload_asset_id"),
	status: text("status").notNull().default("pending"),
	attempts: integer("attempts").notNull().default(0),
	nextAttemptAt: ts("next_attempt_at").notNull(),
	lastError: text("last_error"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	completedAt: ts("completed_at"),
}, (table) => [
	uniqueIndex("asset_cleanup_outbox_object_unique").on(table.bucket, table.objectKey, table.kind),
	index("asset_cleanup_outbox_retry_idx").on(table.status, table.nextAttemptAt),
]);

export const accountDeletionTombstones = sqliteTable("account_deletion_tombstones", {
	requestId: text("request_id").primaryKey(),
	pseudonymousUserHash: text("pseudonymous_user_hash").notNull(),
	workflowInstanceId: text("workflow_instance_id"),
	assetCounts: text("asset_counts").notNull(),
	deletedAt: ts("deleted_at").notNull(),
}, (table) => [index("account_deletion_tombstones_deleted_idx").on(table.deletedAt)]);

// ---------- versioned catalog ----------

export const categories = sqliteTable("categories", {
	id: text("id").primaryKey(),
	slug: text("slug").notNull(),
	name: text("name").notNull(),
	description: text("description"),
	coverAssetKey: text("cover_asset_key"),
	sortOrder: integer("sort_order").notNull().default(0),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("categories_slug_unique").on(table.slug),
	index("categories_active_sort_idx").on(table.isActive, table.sortOrder),
]);

export const pricingVersions = sqliteTable("pricing_versions", {
	id: text("id").primaryKey(),
	priceKey: text("price_key").notNull(),
	version: integer("version").notNull(),
	creditAmount: integer("credit_amount").notNull(),
	currency: text("currency").notNull().default("USD"),
	estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
	status: text("status").notNull().default("draft"),
	publishedAt: ts("published_at"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("pricing_versions_key_version_unique").on(table.priceKey, table.version),
	index("pricing_versions_status_idx").on(table.status, table.createdAt),
]);

export const providers = sqliteTable("providers", {
	id: text("id").primaryKey(),
	providerKey: text("provider_key").notNull(),
	name: text("name").notNull(),
	kind: text("kind").notNull(),
	publicConfig: text("public_config", { mode: "json" }),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
}, (table) => [uniqueIndex("providers_key_unique").on(table.providerKey)]);

export const providerModels = sqliteTable("provider_models", {
	id: text("id").primaryKey(),
	providerId: text("provider_id").notNull().references(() => providers.id, { onDelete: "restrict" }),
	modelKey: text("model_key").notNull(),
	name: text("name").notNull(),
	modality: text("modality").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("provider_models_provider_key_unique").on(table.providerId, table.modelKey),
	index("provider_models_active_idx").on(table.providerId, table.isActive),
]);

export const providerModelVersions = sqliteTable("provider_model_versions", {
	id: text("id").primaryKey(),
	providerModelId: text("provider_model_id").notNull().references(() => providerModels.id, { onDelete: "restrict" }),
	version: integer("version").notNull(),
	providerVersionRef: text("provider_version_ref").notNull(),
	capabilities: text("capabilities", { mode: "json" }).notNull(),
	costConfig: text("cost_config", { mode: "json" }),
	status: text("status").notNull().default("draft"),
	publishedAt: ts("published_at"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("provider_model_versions_version_unique").on(table.providerModelId, table.version),
	uniqueIndex("provider_model_versions_ref_unique").on(table.providerModelId, table.providerVersionRef),
	index("provider_model_versions_status_idx").on(table.status, table.createdAt),
]);

export const templateVersions = sqliteTable("template_versions", {
	id: text("id").primaryKey(),
	templateId: text("template_id").notNull().references(() => templates.id, { onDelete: "restrict" }),
	version: integer("version").notNull(),
	status: text("status").notNull().default("draft"),
	displayName: text("display_name").notNull(),
	description: text("description"),
	previewAssetKey: text("preview_asset_key"),
	pipelineType: text("pipeline_type").notNull(),
	inputSchemaVersion: integer("input_schema_version").notNull().default(1),
	capabilities: text("capabilities", { mode: "json" }).notNull(),
	pricingVersionId: text("pricing_version_id").references(() => pricingVersions.id, { onDelete: "restrict" }),
	configSnapshot: text("config_snapshot", { mode: "json" }).notNull(),
	publishedAt: ts("published_at"),
	createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("template_versions_template_version_unique").on(table.templateId, table.version),
	index("template_versions_status_idx").on(table.status, table.publishedAt),
]);

export const templateCategoryLinks = sqliteTable("template_category_links", {
	templateId: text("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
	categoryId: text("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
	sortOrder: integer("sort_order").notNull().default(0),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	primaryKey({ columns: [table.templateId, table.categoryId] }),
	index("template_category_links_category_sort_idx").on(table.categoryId, table.sortOrder),
]);

export const templateInputDefinitions = sqliteTable("template_input_definitions", {
	id: text("id").primaryKey(),
	templateVersionId: text("template_version_id").notNull().references(() => templateVersions.id, { onDelete: "cascade" }),
	fieldKey: text("field_key").notNull(),
	fieldType: text("field_type").notNull(),
	label: text("label").notNull(),
	helpText: text("help_text"),
	isRequired: integer("is_required", { mode: "boolean" }).notNull().default(false),
	sortOrder: integer("sort_order").notNull().default(0),
	constraints: text("constraints", { mode: "json" }),
	options: text("options", { mode: "json" }),
	visibilityRule: text("visibility_rule", { mode: "json" }),
}, (table) => [
	uniqueIndex("template_input_definitions_field_unique").on(table.templateVersionId, table.fieldKey),
	index("template_input_definitions_sort_idx").on(table.templateVersionId, table.sortOrder),
]);

export const templatePipelineBindings = sqliteTable("template_pipeline_bindings", {
	id: text("id").primaryKey(),
	templateVersionId: text("template_version_id").notNull().references(() => templateVersions.id, { onDelete: "restrict" }),
	providerModelVersionId: text("provider_model_version_id").notNull().references(() => providerModelVersions.id, { onDelete: "restrict" }),
	priority: integer("priority").notNull().default(0),
	rolloutPercent: integer("rollout_percent").notNull().default(100),
	inputMapping: text("input_mapping", { mode: "json" }).notNull(),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("template_pipeline_bindings_model_unique").on(table.templateVersionId, table.providerModelVersionId),
	index("template_pipeline_bindings_route_idx").on(table.templateVersionId, table.isActive, table.priority),
]);

// ---------- voices and characters ----------

export const voices = sqliteTable("voices", {
	id: text("id").primaryKey(),
	slug: text("slug").notNull(),
	name: text("name").notNull(),
	locale: text("locale").notNull(),
	style: text("style"),
	sampleAssetKey: text("sample_asset_key"),
	tags: text("tags", { mode: "json" }),
	isPremium: integer("is_premium", { mode: "boolean" }).notNull().default(false),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	sortOrder: integer("sort_order").notNull().default(0),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("voices_slug_unique").on(table.slug),
	index("voices_catalog_idx").on(table.isActive, table.locale, table.sortOrder),
]);

export const voiceProviderBindings = sqliteTable("voice_provider_bindings", {
	id: text("id").primaryKey(),
	voiceId: text("voice_id").notNull().references(() => voices.id, { onDelete: "restrict" }),
	providerModelVersionId: text("provider_model_version_id").notNull().references(() => providerModelVersions.id, { onDelete: "restrict" }),
	providerVoiceRef: text("provider_voice_ref").notNull(),
	config: text("config", { mode: "json" }),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [uniqueIndex("voice_provider_bindings_unique").on(table.voiceId, table.providerModelVersionId)]);

export const voiceFavorites = sqliteTable("voice_favorites", {
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	voiceId: text("voice_id").notNull().references(() => voices.id, { onDelete: "cascade" }),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	primaryKey({ columns: [table.userId, table.voiceId] }),
	index("voice_favorites_user_created_idx").on(table.userId, table.createdAt),
]);

export const stockCharacters = sqliteTable("stock_characters", {
	id: text("id").primaryKey(),
	slug: text("slug").notNull(),
	name: text("name").notNull(),
	previewAssetKey: text("preview_asset_key").notNull(),
	tags: text("tags", { mode: "json" }),
	consentStatus: text("consent_status").notNull(),
	licenseExpiresAt: ts("license_expires_at"),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("stock_characters_slug_unique").on(table.slug),
	index("stock_characters_catalog_idx").on(table.isActive, table.createdAt),
]);

export const stockCharacterProviderBindings = sqliteTable("stock_character_provider_bindings", {
	id: text("id").primaryKey(),
	stockCharacterId: text("stock_character_id").notNull().references(() => stockCharacters.id, { onDelete: "restrict" }),
	providerModelVersionId: text("provider_model_version_id").notNull().references(() => providerModelVersions.id, { onDelete: "restrict" }),
	providerCharacterRef: text("provider_character_ref").notNull(),
	config: text("config", { mode: "json" }),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [uniqueIndex("stock_character_provider_bindings_unique").on(table.stockCharacterId, table.providerModelVersionId)]);

export const userCharacters = sqliteTable("user_characters", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	status: text("status").notNull().default("draft"),
	currentVersionId: text("current_version_id"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
	archivedAt: ts("archived_at"),
}, (table) => [index("user_characters_tenant_status_idx").on(table.userId, table.status, table.updatedAt)]);

export const userCharacterVersions = sqliteTable("user_character_versions", {
	id: text("id").primaryKey(),
	userCharacterId: text("user_character_id").notNull().references(() => userCharacters.id, { onDelete: "restrict" }),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	version: integer("version").notNull(),
	status: text("status").notNull().default("processing"),
	sourceAssetKey: text("source_asset_key").notNull(),
	previewAssetKey: text("preview_asset_key"),
	consentRecord: text("consent_record", { mode: "json" }).notNull(),
	providerRefs: text("provider_refs", { mode: "json" }),
	moderationResult: text("moderation_result", { mode: "json" }),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	readyAt: ts("ready_at"),
}, (table) => [
	uniqueIndex("user_character_versions_version_unique").on(table.userCharacterId, table.version),
	uniqueIndex("user_character_versions_source_unique").on(table.sourceAssetKey),
	index("user_character_versions_tenant_status_idx").on(table.userId, table.status, table.createdAt),
]);

export const userUploadAssets = sqliteTable("user_upload_assets", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	objectKey: text("object_key").notNull(),
	kind: text("kind").notNull(),
	contentType: text("content_type").notNull(),
	declaredSize: integer("declared_size").notNull(),
	actualSize: integer("actual_size"),
	status: text("status").notNull().default("pending"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
	finalizedAt: ts("finalized_at"),
	purpose: text("purpose"),
	cleanupAfter: ts("cleanup_after"),
}, (table) => [
	uniqueIndex("user_upload_assets_object_unique").on(table.objectKey),
	index("user_upload_assets_tenant_status_idx").on(table.userId, table.status, table.createdAt),
	index("user_upload_assets_cleanup_idx").on(table.purpose, table.cleanupAfter, table.status),
]);

export const characterMutations = sqliteTable("character_mutations", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	idempotencyKey: text("idempotency_key").notNull(),
	requestFingerprint: text("request_fingerprint").notNull(),
	responseSnapshot: text("response_snapshot", { mode: "json" }).notNull(),
	assetId: text("asset_id").notNull().references(() => userUploadAssets.id, { onDelete: "restrict" }),
	characterId: text("character_id").notNull().references(() => userCharacters.id, { onDelete: "cascade" }),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("character_mutations_tenant_key_unique").on(table.userId, table.idempotencyKey),
	uniqueIndex("character_mutations_asset_unique").on(table.assetId),
]);

// ---------- generation jobs and credit reservations ----------

/**
 * Correctness-critical quote snapshots live in D1. KV may cache published
 * catalog data, but its eventual consistency is not suitable for an immediate
 * quote -> paid job hand-off.
 */
export const generationQuotes = sqliteTable("generation_quotes", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	payload: text("payload", { mode: "json" }).notNull(),
	expiresAt: ts("expires_at").notNull(),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	index("generation_quotes_tenant_expiry_idx").on(table.userId, table.expiresAt),
]);

export const generationJobs = sqliteTable("generation_jobs", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
	templateId: text("template_id").notNull().references(() => templates.id, { onDelete: "restrict" }),
	templateVersionId: text("template_version_id").notNull().references(() => templateVersions.id, { onDelete: "restrict" }),
	pricingVersionId: text("pricing_version_id").notNull().references(() => pricingVersions.id, { onDelete: "restrict" }),
	voiceId: text("voice_id").references(() => voices.id, { onDelete: "set null" }),
	stockCharacterId: text("stock_character_id").references(() => stockCharacters.id, { onDelete: "set null" }),
	userCharacterVersionId: text("user_character_version_id").references(() => userCharacterVersions.id, { onDelete: "set null" }),
	idempotencyKey: text("idempotency_key").notNull(),
	requestId: text("request_id").notNull(),
	workflowInstanceId: text("workflow_instance_id"),
	status: text("status").notNull().default("draft"),
	progress: integer("progress").notNull().default(0),
	normalizedInputs: text("normalized_inputs", { mode: "json" }).notNull(),
	configurationSnapshot: text("configuration_snapshot", { mode: "json" }).notNull(),
	quotedCredits: integer("quoted_credits").notNull(),
	estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
	actualCostMicros: integer("actual_cost_micros").notNull().default(0),
	errorCode: text("error_code"),
	errorMessage: text("error_message"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
	completedAt: ts("completed_at"),
}, (table) => [
	uniqueIndex("generation_jobs_tenant_idempotency_unique").on(table.userId, table.idempotencyKey),
	// Sort direction is defined in the SQL migration. Runtime Drizzle columns
	// do not expose `.desc()` in this JavaScript schema representation.
	index("generation_jobs_tenant_history_idx").on(table.userId, table.createdAt, table.id),
	index("generation_jobs_tenant_status_idx").on(table.userId, table.status, table.updatedAt),
	uniqueIndex("generation_jobs_workflow_unique").on(table.workflowInstanceId),
	index("generation_jobs_request_idx").on(table.requestId),
]);

export const generationAttempts = sqliteTable("generation_attempts", {
	id: text("id").primaryKey(),
	jobId: text("job_id").notNull().references(() => generationJobs.id, { onDelete: "cascade" }),
	attemptNumber: integer("attempt_number").notNull(),
	providerId: text("provider_id").notNull().references(() => providers.id, { onDelete: "restrict" }),
	providerModelVersionId: text("provider_model_version_id").notNull().references(() => providerModelVersions.id, { onDelete: "restrict" }),
	providerJobId: text("provider_job_id"),
	status: text("status").notNull().default("created"),
	requestMetadata: text("request_metadata", { mode: "json" }),
	responseMetadata: text("response_metadata", { mode: "json" }),
	errorClass: text("error_class"),
	errorCode: text("error_code"),
	startedAt: ts("started_at"),
	finishedAt: ts("finished_at"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("generation_attempts_job_number_unique").on(table.jobId, table.attemptNumber),
	uniqueIndex("generation_attempts_provider_job_unique").on(table.providerId, table.providerJobId),
	index("generation_attempts_job_status_idx").on(table.jobId, table.status),
]);

export const generationJobEvents = sqliteTable("generation_job_events", {
	id: text("id").primaryKey(),
	jobId: text("job_id").notNull().references(() => generationJobs.id, { onDelete: "cascade" }),
	attemptId: text("attempt_id").references(() => generationAttempts.id, { onDelete: "set null" }),
	providerId: text("provider_id").references(() => providers.id, { onDelete: "restrict" }),
	providerEventId: text("provider_event_id"),
	operationKey: text("operation_key").notNull(),
	source: text("source").notNull(),
	eventType: text("event_type").notNull(),
	fromStatus: text("from_status"),
	toStatus: text("to_status"),
	payload: text("payload", { mode: "json" }),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	uniqueIndex("generation_job_events_operation_unique").on(table.jobId, table.operationKey),
	uniqueIndex("generation_job_events_provider_event_unique").on(table.providerId, table.providerEventId),
	index("generation_job_events_timeline_idx").on(table.jobId, table.createdAt, table.id),
]);

export const generationAssets = sqliteTable("generation_assets", {
	id: text("id").primaryKey(),
	jobId: text("job_id").notNull().references(() => generationJobs.id, { onDelete: "cascade" }),
	attemptId: text("attempt_id").references(() => generationAttempts.id, { onDelete: "set null" }),
	kind: text("kind").notNull(),
	storage: text("storage").notNull(),
	objectKey: text("object_key").notNull(),
	contentType: text("content_type"),
	byteSize: integer("byte_size"),
	checksum: text("checksum"),
	status: text("status").notNull().default("pending"),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	readyAt: ts("ready_at"),
}, (table) => [
	uniqueIndex("generation_assets_object_unique").on(table.storage, table.objectKey),
	index("generation_assets_job_kind_idx").on(table.jobId, table.kind, table.createdAt),
]);

export const creditReservations = sqliteTable("credit_reservations", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	jobId: text("job_id").notNull().references(() => generationJobs.id, { onDelete: "restrict" }),
	operationKey: text("operation_key").notNull(),
	amount: integer("amount").notNull(),
	status: text("status").notNull().default("reserved"),
	reserveTransactionId: text("reserve_transaction_id").references(() => tokenTransactions.id, { onDelete: "set null" }),
	settlementTransactionId: text("settlement_transaction_id").references(() => tokenTransactions.id, { onDelete: "set null" }),
	expiresAt: ts("expires_at").notNull(),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
	settledAt: ts("settled_at"),
}, (table) => [
	uniqueIndex("credit_reservations_tenant_operation_unique").on(table.userId, table.operationKey),
	uniqueIndex("credit_reservations_job_unique").on(table.jobId),
	index("credit_reservations_reconcile_idx").on(table.status, table.expiresAt),
]);

// ---------- admin RBAC and immutable audit trail ----------

export const adminRoles = sqliteTable("admin_roles", {
	id: text("id").primaryKey(),
	roleKey: text("role_key").notNull(),
	name: text("name").notNull(),
	permissions: text("permissions", { mode: "json" }).notNull(),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
}, (table) => [uniqueIndex("admin_roles_key_unique").on(table.roleKey)]);

export const adminUserRoles = sqliteTable("admin_user_roles", {
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	roleId: text("role_id").notNull().references(() => adminRoles.id, { onDelete: "cascade" }),
	grantedBy: text("granted_by").references(() => user.id, { onDelete: "set null" }),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [primaryKey({ columns: [table.userId, table.roleId] })]);

export const adminAuditEvents = sqliteTable("admin_audit_events", {
	id: text("id").primaryKey(),
	actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
	requestId: text("request_id").notNull(),
	action: text("action").notNull(),
	targetType: text("target_type").notNull(),
	targetId: text("target_id"),
	reason: text("reason"),
	beforeSummary: text("before_summary", { mode: "json" }),
	afterSummary: text("after_summary", { mode: "json" }),
	createdAt: ts("created_at").notNull().$defaultFn(now),
}, (table) => [
	index("admin_audit_events_timeline_idx").on(table.createdAt, table.id),
	index("admin_audit_events_actor_idx").on(table.actorUserId, table.createdAt),
	index("admin_audit_events_target_idx").on(table.targetType, table.targetId, table.createdAt),
]);
