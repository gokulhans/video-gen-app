-- Keep the inexpensive P-Video smoke-test template aligned with the server's
-- cost guard. Higher-cost durations, 1080p, and audio belong in separately
-- priced production template versions.
INSERT OR IGNORE INTO `admin_roles` (`id`, `role_key`, `name`, `permissions`, `created_at`, `updated_at`) VALUES
  ('role_catalog_manager', 'catalog_manager', 'Catalog manager', '["catalog.read","catalog.write","catalog.publish","providers.read","providers.write","providers.publish","pricing.read","pricing.write","pricing.publish","voices.read","voices.write","characters.read","characters.write"]', unixepoch() * 1000, unixepoch() * 1000),
  ('role_safety_reviewer', 'safety_reviewer', 'Safety reviewer', '["characters.read","characters.moderate","audit.read"]', unixepoch() * 1000, unixepoch() * 1000),
  ('role_support_analyst', 'support_analyst', 'Support analyst', '["jobs.read","audit.read","legacy.read"]', unixepoch() * 1000, unixepoch() * 1000);

UPDATE `template_versions`
SET `capabilities` = '{"durations":[1],"aspectRatios":["16:9","9:16","1:1"],"resolutions":["720p"],"supportsImage":true,"supportsAudio":false}'
WHERE `id` = 'tplver_pvideo_quick_test_v1';

UPDATE `template_pipeline_bindings`
SET `input_mapping` = '{"prompt":"prompt","imageUrl":"image","lastFrameImageUrl":"last_frame_image","durationSec":"duration","aspectRatio":"aspect_ratio","resolution":"resolution","fps":"fps","draft":"draft","promptUpsampling":"prompt_upsampling"}'
WHERE `id` = 'binding_pvideo_quick_test_v1';

DELETE FROM `template_input_definitions`
WHERE `template_version_id` = 'tplver_pvideo_quick_test_v1'
  AND (`field_key` = 'audioUrl' OR `field_type` = 'audio');

UPDATE `template_input_definitions`
SET `help_text` = 'Fixed to one second for inexpensive smoke tests.',
    `options` = '[{"value":1,"label":"1 second · lowest-cost test"}]'
WHERE `template_version_id` = 'tplver_pvideo_quick_test_v1'
  AND `field_key` = 'durationSec';

UPDATE `template_input_definitions`
SET `options` = '[{"value":"720p","label":"HD · 720p"}]'
WHERE `template_version_id` = 'tplver_pvideo_quick_test_v1'
  AND `field_key` = 'resolution';
