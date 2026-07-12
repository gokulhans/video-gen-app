import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../api_client.dart';
import '../constants.dart';
import '../models/render_job.dart';

/// Render: `POST /:id/render`, `GET /render-jobs/:id`, WS proxied to
/// RenderJobDO (CONTRACTS.md / plan §6).
class RenderRepository {
  RenderRepository(this._api);

  final ApiClient _api;

  Future<RenderJob> startRender(String projectId, RenderResolution resolution) {
    return _api.post<RenderJob>(
      '/projects/$projectId/render',
      body: {'resolution': resolution.wireValue},
      headers: {'Idempotency-Key': const Uuid().v4()},
      parser: (json) => RenderJob.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<RenderJob> getRenderJob(String jobId) {
    return _api.get<RenderJob>(
      '/render-jobs/$jobId',
      parser: (json) => RenderJob.fromJson(json as Map<String, dynamic>),
    );
  }

  /// WebSocket URL for `GET /render-jobs/:id/ws`, proxied to the
  /// `RenderJobDO`. Uses wss:// derived from the configured HTTP base URL.
  String webSocketUrl(String jobId) {
    final httpBase = AppConstants.apiBaseUrl;
    final wsBase = httpBase
        .replaceFirst('https://', 'wss://')
        .replaceFirst('http://', 'ws://');
    return '$wsBase/render-jobs/$jobId/ws';
  }
}

final renderRepositoryProvider = Provider<RenderRepository>((ref) {
  return RenderRepository(ref.watch(apiClientProvider));
});
