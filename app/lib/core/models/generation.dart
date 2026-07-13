import 'package:flutter/foundation.dart';

enum GenerationJobStatus {
  draft,
  validating,
  creditReserved,
  queued,
  submitting,
  providerProcessing,
  ingesting,
  postProcessing,
  rendering,
  publishing,
  completed,
  failed,
  cancelled,
}

GenerationJobStatus _status(String value) => switch (value) {
  'credit_reserved' => GenerationJobStatus.creditReserved,
  'provider_processing' => GenerationJobStatus.providerProcessing,
  'post_processing' => GenerationJobStatus.postProcessing,
  _ => GenerationJobStatus.values.firstWhere(
    (e) => e.name == value,
    orElse: () => GenerationJobStatus.failed,
  ),
};

extension GenerationJobStatusUi on GenerationJobStatus {
  bool get isTerminal =>
      this == GenerationJobStatus.completed ||
      this == GenerationJobStatus.failed ||
      this == GenerationJobStatus.cancelled;
  bool get canCancel => this == GenerationJobStatus.queued;
  String get label => switch (this) {
    GenerationJobStatus.creditReserved => 'Credits reserved',
    GenerationJobStatus.providerProcessing => 'Creating video',
    GenerationJobStatus.postProcessing => 'Finishing video',
    _ => name[0].toUpperCase() + name.substring(1),
  };
}

@immutable
class GenerationQuote {
  const GenerationQuote({
    required this.quoteId,
    required this.templateVersionId,
    required this.pricingVersionId,
    required this.creditAmount,
    required this.estimatedMinSec,
    required this.estimatedMaxSec,
    required this.expiresAt,
  });
  final String quoteId;
  final String templateVersionId;
  final String pricingVersionId;
  final int creditAmount;
  final int estimatedMinSec;
  final int estimatedMaxSec;
  final DateTime expiresAt;

  factory GenerationQuote.fromJson(Map<String, dynamic> json) {
    final duration = json['estimatedDurationSec'] as Map<String, dynamic>;
    return GenerationQuote(
      quoteId: json['quoteId'] as String,
      templateVersionId: json['templateVersionId'] as String,
      pricingVersionId: json['pricingVersionId'] as String,
      creditAmount: (json['creditAmount'] as num).toInt(),
      estimatedMinSec: (duration['min'] as num).toInt(),
      estimatedMaxSec: (duration['max'] as num).toInt(),
      expiresAt: DateTime.fromMillisecondsSinceEpoch(
        (json['expiresAt'] as num).toInt(),
      ),
    );
  }
}

@immutable
class GenerationJob {
  const GenerationJob({
    required this.id,
    required this.templateId,
    required this.templateVersionId,
    required this.status,
    required this.progress,
    required this.quotedCredits,
    required this.createdAt,
    required this.updatedAt,
    this.previewAssetId,
    this.videoAssetId,
    this.errorMessage,
    this.completedAt,
  });
  final String id;
  final String templateId;
  final String templateVersionId;
  final GenerationJobStatus status;
  final int progress;
  final int quotedCredits;
  final String? previewAssetId;
  final String? videoAssetId;
  final String? errorMessage;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? completedAt;

  factory GenerationJob.fromJson(Map<String, dynamic> json) {
    final error = json['error'] as Map<String, dynamic>?;
    DateTime date(Object? value) =>
        DateTime.fromMillisecondsSinceEpoch((value as num).toInt());
    return GenerationJob(
      id: json['id'] as String,
      templateId: json['templateId'] as String,
      templateVersionId: json['templateVersionId'] as String,
      status: _status(json['status'] as String),
      progress: (json['progress'] as num).toInt(),
      quotedCredits: (json['quotedCredits'] as num).toInt(),
      previewAssetId: json['previewAssetId'] as String?,
      videoAssetId: json['videoAssetId'] as String?,
      errorMessage: error?['message'] as String?,
      createdAt: date(json['createdAt']),
      updatedAt: date(json['updatedAt']),
      completedAt: json['completedAt'] == null
          ? null
          : date(json['completedAt']),
    );
  }
}

@immutable
class CursorPage<T> {
  const CursorPage({required this.items, this.nextCursor});
  final List<T> items;
  final String? nextCursor;
}

@immutable
class GenerationSelection {
  const GenerationSelection({
    required this.templateVersionId,
    required this.inputs,
    this.voiceId,
    this.brandId,
  });
  final String templateVersionId;
  final Map<String, dynamic> inputs;
  final String? voiceId;
  final String? brandId;
  Map<String, dynamic> toJson() => {
    'templateVersionId': templateVersionId,
    'inputs': inputs,
    if (voiceId != null) 'voiceId': voiceId,
    if (brandId != null) 'brandId': brandId,
  };
}

@immutable
class GenerationAssetDelivery {
  const GenerationAssetDelivery({
    required this.assetId,
    this.hlsUrl,
    this.dashUrl,
    this.playbackUrlValue,
    this.downloadUrl,
  });

  final String assetId;
  final String? hlsUrl;
  final String? dashUrl;
  final String? playbackUrlValue;
  final String? downloadUrl;

  String? get playbackUrl =>
      hlsUrl ?? dashUrl ?? playbackUrlValue ?? downloadUrl;

  factory GenerationAssetDelivery.fromJson(Map<String, dynamic> json) =>
      GenerationAssetDelivery(
        assetId: json['assetId'] as String,
        hlsUrl: json['hlsUrl'] as String?,
        dashUrl: json['dashUrl'] as String?,
        playbackUrlValue: json['playbackUrl'] as String?,
        downloadUrl: json['downloadUrl'] as String?,
      );
}
