import 'package:equatable/equatable.dart';

import 'composition.dart';

enum GenerationStatus { idle, running, failed, complete }

extension GenerationStatusX on GenerationStatus {
  String get wireValue => name;
  static GenerationStatus fromWire(String? value) => switch (value) {
        'running' => GenerationStatus.running,
        'failed' => GenerationStatus.failed,
        'complete' => GenerationStatus.complete,
        _ => GenerationStatus.idle,
      };
}

/// A project row as returned by the API (list/detail).
class Project extends Equatable {
  const Project({
    required this.id,
    required this.name,
    this.templateId,
    this.brandId,
    this.generationStatus = GenerationStatus.idle,
    this.workflowInstanceId,
    this.composition,
    this.ratio,
    this.language,
    this.thumbnailUrl,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String? templateId;
  final String? brandId;
  final GenerationStatus generationStatus;
  final String? workflowInstanceId;
  final ProjectComposition? composition;
  final String? ratio;
  final String? language;
  final String? thumbnailUrl;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// True once a rendered video already exists for this project. Combined
  /// with [generationStatus] to drive the home-screen status chip.
  bool get isRendering => false;

  factory Project.fromJson(Map<String, dynamic> json) => Project(
        id: json['id'] as String,
        name: json['name'] as String? ?? 'Untitled project',
        templateId: json['templateId'] as String?,
        brandId: json['brandId'] as String?,
        generationStatus: GenerationStatusX.fromWire(json['generationStatus'] as String?),
        workflowInstanceId: json['workflowInstanceId'] as String?,
        composition: json['composition'] != null
            ? ProjectComposition.fromJson(json['composition'] as Map<String, dynamic>)
            : null,
        ratio: json['ratio'] as String?,
        language: json['language'] as String?,
        thumbnailUrl: json['thumbnailUrl'] as String?,
        createdAt: DateTime.fromMillisecondsSinceEpoch((json['createdAt'] as num?)?.toInt() ?? 0),
        updatedAt: DateTime.fromMillisecondsSinceEpoch((json['updatedAt'] as num?)?.toInt() ?? 0),
      );

  @override
  List<Object?> get props => [
        id,
        name,
        templateId,
        brandId,
        generationStatus,
        workflowInstanceId,
        composition,
        ratio,
        language,
        thumbnailUrl,
        createdAt,
        updatedAt,
      ];
}

/// Status chip shown on the home screen. Distinct from [GenerationStatus]
/// because "rendering" and "ready" are derived from render job state, not
/// only the generation pipeline.
enum ProjectStatusChip { draft, generating, ready, rendering, failed }

ProjectStatusChip projectStatusChipFor(Project project, {bool hasActiveRenderJob = false}) {
  if (hasActiveRenderJob) return ProjectStatusChip.rendering;
  switch (project.generationStatus) {
    case GenerationStatus.running:
      return ProjectStatusChip.generating;
    case GenerationStatus.failed:
      return ProjectStatusChip.failed;
    case GenerationStatus.complete:
      return ProjectStatusChip.ready;
    case GenerationStatus.idle:
      return ProjectStatusChip.draft;
  }
}
