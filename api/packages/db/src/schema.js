import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
});

export const templates = sqliteTable("templates", {
	id: text("id").primaryKey(),
	vertical: text("vertical").notNull(), // restaurant|salon|real_estate|...
	name: text("name").notNull(),
	previewVideoUrl: text("preview_video_url"),
	scriptPromptPreset: text("script_prompt_preset").notNull(),
	imageStylePreset: text("image_style_preset").notNull(),
	musicTrackUrl: text("music_track_url"),
	captionStyle: text("caption_style", { mode: "json" }),
	defaultDuration: integer("default_duration").notNull().default(45),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: ts("created_at").notNull().$defaultFn(now),
	updatedAt: ts("updated_at").notNull().$defaultFn(now),
});

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
	createdAt: ts("created_at").notNull().$defaultFn(now),
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
});

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
