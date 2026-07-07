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
