import 'package:equatable/equatable.dart';

String _firstLanguage(Map<String, dynamic> json) {
  final languages = json['languages'];
  if (languages is List && languages.isNotEmpty && languages.first is String) {
    return languages.first as String;
  }
  return 'en';
}

/// Mirrors the `templates` table (packages/db/src/schema.js) as exposed by
/// `GET /templates`.
class VideoTemplate extends Equatable {
  const VideoTemplate({
    required this.id,
    required this.vertical,
    required this.name,
    this.previewVideoUrl,
    this.thumbnailUrl,
    required this.defaultDuration,
    this.musicTrackUrl,
    this.isActive = true,
  });

  final String id;
  final String vertical; // restaurant|salon|real_estate|...
  final String name;
  final String? previewVideoUrl;
  final String? thumbnailUrl;
  final int defaultDuration;
  final String? musicTrackUrl;
  final bool isActive;

  factory VideoTemplate.fromJson(Map<String, dynamic> json) => VideoTemplate(
    id: json['id'] as String,
    vertical: json['vertical'] as String? ?? 'general',
    name: json['name'] as String? ?? '',
    previewVideoUrl: json['previewVideoUrl'] as String?,
    thumbnailUrl: json['thumbnailUrl'] as String?,
    defaultDuration: (json['defaultDuration'] as num?)?.toInt() ?? 45,
    musicTrackUrl: json['musicTrackUrl'] as String?,
    isActive: json['isActive'] as bool? ?? true,
  );

  @override
  List<Object?> get props => [
    id,
    vertical,
    name,
    previewVideoUrl,
    thumbnailUrl,
    defaultDuration,
    musicTrackUrl,
    isActive,
  ];
}

/// A selectable TTS voice (not persisted server-side as its own table; the
/// API exposes a static/curated list, mirrored here for the picker UI).
class VoiceOption extends Equatable {
  const VoiceOption({
    required this.id,
    required this.label,
    required this.language,
    this.sampleUrl,
    this.gender,
  });

  final String id;
  final String label;
  final String language;
  final String? sampleUrl;
  final String? gender;

  factory VoiceOption.fromJson(Map<String, dynamic> json) => VoiceOption(
    id: json['id'] as String,
    label:
        json['label'] as String? ??
        json['name'] as String? ??
        json['id'] as String,
    language: json['language'] as String? ?? _firstLanguage(json),
    sampleUrl: json['sampleUrl'] as String?,
    gender: json['gender'] as String?,
  );

  @override
  List<Object?> get props => [id, label, language, sampleUrl, gender];
}
