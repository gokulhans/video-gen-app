import 'package:equatable/equatable.dart';

import 'composition.dart';

enum RenderResolution { p720, p1080 }

extension RenderResolutionX on RenderResolution {
  String get wireValue => switch (this) {
        RenderResolution.p720 => '720p',
        RenderResolution.p1080 => '1080p',
      };

  String get label => switch (this) {
        RenderResolution.p720 => '720p (HD)',
        RenderResolution.p1080 => '1080p (Full HD)',
      };

  static RenderResolution fromWire(String? value) =>
      value == '1080p' ? RenderResolution.p1080 : RenderResolution.p720;
}

/// Mirrors the `render_jobs` table / `GET /render-jobs/:id` response.
class RenderJob extends Equatable {
  const RenderJob({
    required this.id,
    this.projectId,
    required this.resolution,
    required this.status,
    this.videoUrl,
    this.progress = 0,
    this.error,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String? projectId;
  final RenderResolution resolution;
  final RenderStatus status;
  final String? videoUrl;
  final double progress;
  final String? error;
  final DateTime createdAt;
  final DateTime updatedAt;

  factory RenderJob.fromJson(Map<String, dynamic> json) => RenderJob(
        id: json['id'] as String,
        projectId: json['projectId'] as String?,
        resolution: RenderResolutionX.fromWire(json['resolution'] as String?),
        status: RenderStatusX.fromWire(json['status'] as String?),
        videoUrl: json['videoUrl'] as String?,
        progress: (json['progress'] as num?)?.toDouble() ?? 0,
        error: json['error'] as String?,
        createdAt: DateTime.fromMillisecondsSinceEpoch((json['createdAt'] as num?)?.toInt() ?? 0),
        updatedAt: DateTime.fromMillisecondsSinceEpoch((json['updatedAt'] as num?)?.toInt() ?? 0),
      );

  RenderJob copyWithProgress(RenderProgressMessage message) => RenderJob(
        id: id,
        projectId: projectId,
        resolution: resolution,
        status: message.status,
        videoUrl: message.videoUrl ?? videoUrl,
        progress: message.progress,
        error: message.error,
        createdAt: createdAt,
        updatedAt: DateTime.now(),
      );

  @override
  List<Object?> get props =>
      [id, projectId, resolution, status, videoUrl, progress, error, createdAt, updatedAt];
}
