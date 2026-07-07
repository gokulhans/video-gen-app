import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../models/composition.dart';
import '../models/project.dart';

/// Wraps the `/projects` and generation endpoints described in
/// CONTRACTS.md / Cloudflare_Rewrite_Plan.md §6.
class ProjectRepository {
  ProjectRepository(this._api);

  final ApiClient _api;

  Future<List<Project>> listProjects() {
    return _api.get<List<Project>>(
      '/projects',
      parser: (json) =>
          (json as List<dynamic>).map((e) => Project.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<Project> getProject(String id) {
    return _api.get<Project>(
      '/projects/$id',
      parser: (json) => Project.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<Project> createProject({required String name, String? templateId, String? brandId}) {
    return _api.post<Project>(
      '/projects',
      body: {'name': name, 'templateId': templateId, 'brandId': brandId},
      parser: (json) => Project.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<void> deleteProject(String id) {
    return _api.delete<void>('/projects/$id');
  }

  /// Starts the `GenerationPipeline` Workflow. Returns the updated project
  /// (with `workflowInstanceId` and `generationStatus: running`).
  Future<Project> startGeneration(String projectId, GenerationParams params) {
    return _api.post<Project>(
      '/projects/$projectId/generate',
      body: params.toJson(),
      parser: (json) => Project.fromJson(json as Map<String, dynamic>),
    );
  }

  /// Polls Workflow instance status. Shape:
  /// `{ status: idle|running|failed|complete, stage, progress, error?, composition? }`
  Future<GenerationStatusResponse> getGenerationStatus(String projectId) {
    return _api.get<GenerationStatusResponse>(
      '/projects/$projectId/generation-status',
      parser: (json) => GenerationStatusResponse.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<void> retryGeneration(String projectId) {
    return _api.post<void>('/projects/$projectId/generate/retry');
  }

  /// Autosave — debounced 2s from the editor.
  Future<void> patchComposition(String projectId, ProjectComposition composition) {
    return _api.patch<void>(
      '/projects/$projectId/composition',
      body: composition.toJson(),
    );
  }

  Future<ProjectComposition> rewriteScript(String projectId, {String? instruction}) {
    return _api.post<ProjectComposition>(
      '/projects/$projectId/script/rewrite',
      body: {'instruction': instruction},
      parser: (json) => ProjectComposition.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<Scene> regenerateSceneImage(String projectId, String sceneId) {
    return _api.post<Scene>(
      '/projects/$projectId/scenes/$sceneId/regenerate-image',
      parser: (json) => Scene.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<ProjectComposition> regenerateVoice(String projectId, {String? voice}) {
    return _api.post<ProjectComposition>(
      '/projects/$projectId/voice/regenerate',
      body: {'voice': voice},
      parser: (json) => ProjectComposition.fromJson(json as Map<String, dynamic>),
    );
  }
}

class GenerationStatusResponse {
  const GenerationStatusResponse({
    required this.status,
    required this.stage,
    required this.progress,
    this.error,
    this.composition,
  });

  final GenerationStatus status;
  final GenerationStage stage;
  final double progress; // 0..100
  final String? error;
  final ProjectComposition? composition;

  factory GenerationStatusResponse.fromJson(Map<String, dynamic> json) => GenerationStatusResponse(
        status: GenerationStatusX.fromWire(json['status'] as String?),
        stage: GenerationStageX.fromWire(json['stage'] as String?),
        progress: (json['progress'] as num?)?.toDouble() ?? 0,
        error: json['error'] as String?,
        composition: json['composition'] != null
            ? ProjectComposition.fromJson(json['composition'] as Map<String, dynamic>)
            : null,
      );
}

final projectRepositoryProvider = Provider<ProjectRepository>((ref) {
  return ProjectRepository(ref.watch(apiClientProvider));
});
