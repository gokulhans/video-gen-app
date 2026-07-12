import 'package:flutter/foundation.dart';

@immutable
class VoiceProfile {
  const VoiceProfile({
    required this.id,
    required this.slug,
    required this.name,
    required this.locale,
    required this.tags,
    required this.isPremium,
    required this.isFavorite,
    this.style,
    this.sampleAssetKey,
    this.sampleUrl,
  });
  final String id;
  final String slug;
  final String name;
  final String locale;
  final String? style;
  final List<String> tags;
  final bool isPremium;
  final bool isFavorite;
  final String? sampleAssetKey;
  final String? sampleUrl;
  factory VoiceProfile.fromJson(Map<String, dynamic> json) => VoiceProfile(
    id: json['id'] as String,
    slug: json['slug'] as String,
    name: (json['name'] ?? json['label']) as String,
    locale: json['locale'] as String? ?? 'en',
    style: json['style'] as String?,
    tags: (json['tags'] as List<dynamic>? ?? const [])
        .whereType<String>()
        .toList(growable: false),
    isPremium: json['isPremium'] == true,
    isFavorite: json['isFavorite'] == true,
    sampleAssetKey: json['sampleAssetKey'] as String?,
    sampleUrl: json['sampleUrl'] as String?,
  );
  VoiceProfile copyWith({bool? isFavorite}) => VoiceProfile(
    id: id,
    slug: slug,
    name: name,
    locale: locale,
    tags: tags,
    isPremium: isPremium,
    isFavorite: isFavorite ?? this.isFavorite,
    style: style,
    sampleAssetKey: sampleAssetKey,
    sampleUrl: sampleUrl,
  );
}

@immutable
class StockCharacter {
  const StockCharacter({
    required this.id,
    required this.slug,
    required this.name,
    required this.previewAssetKey,
    required this.tags,
    this.licenseExpiresAt,
    this.previewUrl,
  });
  final String id;
  final String slug;
  final String name;
  final String previewAssetKey;
  final List<String> tags;
  final DateTime? licenseExpiresAt;
  final String? previewUrl;
  factory StockCharacter.fromJson(Map<String, dynamic> json) => StockCharacter(
    id: json['id'] as String,
    slug: json['slug'] as String,
    name: json['name'] as String,
    previewAssetKey: json['previewAssetKey'] as String,
    tags: (json['tags'] as List<dynamic>? ?? const [])
        .whereType<String>()
        .toList(growable: false),
    licenseExpiresAt: json['licenseExpiresAt'] == null
        ? null
        : DateTime.fromMillisecondsSinceEpoch(
            (json['licenseExpiresAt'] as num).toInt(),
          ),
    previewUrl: json['previewUrl'] as String?,
  );
}

enum UserCharacterStatus {
  pendingReview,
  processing,
  ready,
  rejected,
  archived,
}

@immutable
class UserCharacter {
  const UserCharacter({
    required this.id,
    required this.name,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.currentVersionId,
    this.previewAssetKey,
    this.archivedAt,
    this.previewUrl,
    this.rejectionReason,
  });
  final String id;
  final String name;
  final UserCharacterStatus status;
  final String? currentVersionId;
  final String? previewAssetKey;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? archivedAt;
  final String? previewUrl;
  final String? rejectionReason;
  factory UserCharacter.fromJson(Map<String, dynamic> json) {
    DateTime date(Object? value) =>
        DateTime.fromMillisecondsSinceEpoch((value as num).toInt());
    final raw = (json['status'] ?? json['versionStatus'] ?? 'pending_review')
        .toString();
    final status = switch (raw) {
      'ready' => UserCharacterStatus.ready,
      'processing' => UserCharacterStatus.processing,
      'rejected' => UserCharacterStatus.rejected,
      'archived' => UserCharacterStatus.archived,
      _ => UserCharacterStatus.pendingReview,
    };
    return UserCharacter(
      id: json['id'] as String,
      name: json['name'] as String,
      status: status,
      currentVersionId: json['currentVersionId'] as String?,
      previewAssetKey: json['previewAssetKey'] as String?,
      createdAt: date(json['createdAt']),
      updatedAt: date(json['updatedAt']),
      archivedAt: json['archivedAt'] == null ? null : date(json['archivedAt']),
      previewUrl: json['previewUrl'] as String?,
      rejectionReason:
          (json['moderationResult'] as Map<String, dynamic>?)?['reason']
              as String?,
    );
  }
}
