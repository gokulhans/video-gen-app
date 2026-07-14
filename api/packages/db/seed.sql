-- Seed data: run once after migrations.
-- wrangler d1 execute ai-video-db --remote --file=packages/db/seed.sql

-- System settings
INSERT OR IGNORE INTO settings (id, default_signup_bonus, minimum_token_balance, enable_token_system, enable_signup_bonus, max_tokens_per_user, token_expiration_days, created_at, updated_at)
VALUES ('system', 600, 50, 1, 1, 100000, 0, unixepoch()*1000, unixepoch()*1000);

-- Token costs (admin-tunable later via admin dashboard)
INSERT OR IGNORE INTO token_costs (id, action, cost, description, is_active, created_at, updated_at) VALUES
	('tc_script',  'script_generation', 20,  'Generate video script',            1, unixepoch()*1000, unixepoch()*1000),
	('tc_rewrite', 'script_rewrite',    10,  'AI rewrite of a scene script',     1, unixepoch()*1000, unixepoch()*1000),
	('tc_voice',   'voice_generation',  30,  'Generate voiceover narration',     1, unixepoch()*1000, unixepoch()*1000),
	('tc_image',   'image_generation',  10,  'Generate one AI scene image',      1, unixepoch()*1000, unixepoch()*1000),
	('tc_r720',    'render_720p',       50,  'Cloud render at 720p',             1, unixepoch()*1000, unixepoch()*1000),
	('tc_r1080',   'render_1080p',      100, 'Cloud render at 1080p',            1, unixepoch()*1000, unixepoch()*1000);

INSERT OR IGNORE INTO admin_roles (id, role_key, name, permissions, created_at, updated_at) VALUES
	('role_catalog_manager', 'catalog_manager', 'Catalog manager', '["catalog.read","catalog.write","catalog.publish","providers.read","providers.write","providers.publish","pricing.read","pricing.write","pricing.publish","voices.read","voices.write","characters.read","characters.write"]', unixepoch()*1000, unixepoch()*1000),
	('role_safety_reviewer', 'safety_reviewer', 'Safety reviewer', '["characters.read","characters.moderate","audit.read"]', unixepoch()*1000, unixepoch()*1000),
	('role_support_analyst', 'support_analyst', 'Support analyst', '["jobs.read","audit.read","legacy.read"]', unixepoch()*1000, unixepoch()*1000);

-- Launch templates: 3 focus verticals (restaurant, salon, real estate)
INSERT OR IGNORE INTO templates (id, vertical, name, preview_video_url, script_prompt_preset, image_style_preset, music_track_url, caption_style, default_duration, is_active, created_at, updated_at) VALUES
	('tpl_restaurant_offer', 'restaurant', 'Restaurant Offer',
	 NULL,
	 'You are writing a 30-60 second promotional narration for an Indian restaurant. Warm, appetizing, energetic tone. Mention the dish/offer the user describes, weave in taste and freshness language, end with a clear call to action (visit / order / call). Keep sentences short and punchy for voiceover.',
	 'professional food photography, warm golden lighting, shallow depth of field, vibrant Indian cuisine, steam rising, appetizing close-up, restaurant ambience background',
	 NULL,
	 '{"preset":"tiktok","position":"bottom","primaryColor":"#FFFFFF","highlightColor":"#FFB020","fontSize":48,"enabled":true}',
	 40, 1, unixepoch()*1000, unixepoch()*1000),
	('tpl_salon_promo', 'salon', 'Salon / Beauty Promo',
	 NULL,
	 'You are writing a 30-60 second promotional narration for a beauty salon or spa. Aspirational, confident, friendly tone. Highlight the service or offer the user describes, focus on transformation and self-care, end with a booking call to action. Short sentences, voiceover-friendly.',
	 'high-end beauty salon photography, soft studio lighting, elegant interior, glamour styling, clean modern aesthetic, pastel tones',
	 NULL,
	 '{"preset":"clean","position":"bottom","primaryColor":"#FFFFFF","highlightColor":"#FF6FA5","fontSize":46,"enabled":true}',
	 40, 1, unixepoch()*1000, unixepoch()*1000),
	('tpl_realestate_listing', 'real_estate', 'Property Listing',
	 NULL,
	 'You are writing a 30-60 second narration promoting a property listing. Trustworthy, premium, informative tone. Cover location, key features, and price/offer the user describes; end with a call to action to schedule a visit or call. Short factual sentences suited to voiceover.',
	 'architectural photography, wide angle real estate interior, bright natural light, modern Indian apartment, premium finishes, golden hour exterior',
	 NULL,
	 '{"preset":"bold","position":"bottom","primaryColor":"#FFFFFF","highlightColor":"#38BDF8","fontSize":46,"enabled":true}',
	 45, 1, unixepoch()*1000, unixepoch()*1000);

-- Low-cost, pinned P-Video launch/test configuration. Pricing is deliberately
-- versioned because provider prices may change; admin publishes a new version
-- instead of rewriting historical quotes/jobs.
INSERT OR IGNORE INTO providers (id, provider_key, name, kind, public_config, is_active, created_at, updated_at)
VALUES ('provider_replicate', 'replicate', 'Replicate', 'video', '{}', 1, unixepoch()*1000, unixepoch()*1000);

INSERT OR IGNORE INTO provider_models (id, provider_id, model_key, name, modality, is_active, created_at, updated_at)
VALUES ('model_pvideo', 'provider_replicate', 'prunaai/p-video', 'Pruna P-Video', 'video', 1, unixepoch()*1000, unixepoch()*1000);

INSERT OR IGNORE INTO provider_model_versions
	(id, provider_model_id, version, provider_version_ref, capabilities, cost_config, status, published_at, created_at)
VALUES
	('modelver_pvideo_68b33', 'model_pvideo', 1,
	 '68b33d8ba1189a1a997abf2c09edc5bbb90d6cfa239befbf9c903bcfee7f9a59',
	 '{"durations":{"min":1,"max":20},"aspectRatios":["16:9","9:16","4:3","3:4","3:2","2:3","1:1"],"resolutions":["720p","1080p"],"fps":[24,48],"image":true,"audio":true,"lastFrameImage":true,"draft":true}',
	 '{"currency":"USD","draft720pMicrosPerSecond":5000,"final720pMicrosPerSecond":20000,"draft1080pMicrosPerSecond":10000,"final1080pMicrosPerSecond":40000}',
	 'published', unixepoch()*1000, unixepoch()*1000);

INSERT OR IGNORE INTO pricing_versions
	(id, price_key, version, credit_amount, currency, estimated_cost_micros, status, published_at, created_at)
VALUES ('price_pvideo_test_v1', 'pvideo_test', 1, 5, 'USD', 5000, 'published', unixepoch()*1000, unixepoch()*1000);

INSERT OR IGNORE INTO categories (id, slug, name, description, sort_order, is_active, created_at, updated_at)
VALUES ('cat_product_video', 'product_video', 'Product video', 'Fast product and business video tests.', -100, 1, unixepoch()*1000, unixepoch()*1000);

INSERT OR IGNORE INTO templates
	(id, slug, vertical, name, preview_video_url, script_prompt_preset, image_style_preset, default_duration, is_active, lifecycle_status, current_version_id, created_at, updated_at)
VALUES
	('tpl_pvideo_quick_test', 'pvideo-quick-test', 'product_video', 'P-Video Quick Test', NULL,
	 'Describe a concise, visually specific business video shot.', 'photorealistic commercial product video',
	 1, 1, 'active', 'tplver_pvideo_quick_test_v1', unixepoch()*1000, unixepoch()*1000);

INSERT OR IGNORE INTO template_versions
	(id, template_id, version, status, display_name, description, pipeline_type, input_schema_version, capabilities, pricing_version_id, config_snapshot, published_at, created_at)
VALUES
	('tplver_pvideo_quick_test_v1', 'tpl_pvideo_quick_test', 1, 'published', 'P-Video Quick Test',
	 'Generate a one-second draft at the lowest practical test cost. Upgrade quality before customer delivery.',
	 'p_video', 1,
	 '{"durations":[1],"aspectRatios":["16:9","9:16","1:1"],"resolutions":["720p"],"supportsImage":true,"supportsAudio":false}',
	 'price_pvideo_test_v1',
	 '{"provider":"replicate","model":"prunaai/p-video","modelVersion":"68b33d8ba1189a1a997abf2c09edc5bbb90d6cfa239befbf9c903bcfee7f9a59","mode":"test","defaults":{"durationSec":1,"aspectRatio":"16:9","resolution":"720p","fps":24,"draft":true,"promptUpsampling":true,"includeGeneratedAudio":false}}',
	 unixepoch()*1000, unixepoch()*1000);

INSERT OR IGNORE INTO template_category_links (template_id, category_id, sort_order, created_at)
VALUES ('tpl_pvideo_quick_test', 'cat_product_video', -100, unixepoch()*1000);

INSERT OR IGNORE INTO template_pipeline_bindings
	(id, template_version_id, provider_model_version_id, priority, rollout_percent, input_mapping, is_active, created_at)
VALUES
	('binding_pvideo_quick_test_v1', 'tplver_pvideo_quick_test_v1', 'modelver_pvideo_68b33', 0, 100,
	 '{"prompt":"prompt","imageUrl":"image","lastFrameImageUrl":"last_frame_image","durationSec":"duration","aspectRatio":"aspect_ratio","resolution":"resolution","fps":"fps","draft":"draft","promptUpsampling":"prompt_upsampling"}',
	 1, unixepoch()*1000);

INSERT OR IGNORE INTO template_input_definitions
	(id, template_version_id, field_key, field_type, label, help_text, is_required, sort_order, constraints, options)
VALUES
	('input_pvideo_prompt', 'tplver_pvideo_quick_test_v1', 'prompt', 'long_text', 'Describe your video', 'Include the subject, setting, camera movement, lighting, and action.', 1, 10, '{"minLength":3,"maxLength":5000}', NULL),
	('input_pvideo_image', 'tplver_pvideo_quick_test_v1', 'imageUrl', 'image', 'Starting image', 'Optional. The image controls the output canvas.', 0, 20, '{"maxFiles":1,"maxBytes":15000000,"acceptedContentTypes":["image/jpeg","image/png","image/webp"]}', NULL),
	('input_pvideo_duration', 'tplver_pvideo_quick_test_v1', 'durationSec', 'select', 'Duration', 'Fixed to one second for inexpensive smoke tests.', 1, 40, NULL, '[{"value":1,"label":"1 second · lowest-cost test"}]'),
	('input_pvideo_aspect', 'tplver_pvideo_quick_test_v1', 'aspectRatio', 'select', 'Aspect ratio', NULL, 1, 50, NULL, '[{"value":"16:9","label":"Landscape · 16:9"},{"value":"9:16","label":"Portrait · 9:16"},{"value":"1:1","label":"Square · 1:1"}]'),
	('input_pvideo_resolution', 'tplver_pvideo_quick_test_v1', 'resolution', 'select', 'Resolution', NULL, 1, 60, NULL, '[{"value":"720p","label":"HD · 720p"}]');
