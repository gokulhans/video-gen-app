import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../models/generation.dart';

abstract interface class GenerationRepository {
  Future<GenerationQuote> quote(GenerationSelection selection);
  Future<GenerationJob> createJob({
    required GenerationSelection selection,
    required String quoteId,
    required String idempotencyKey,
  });
  Future<CursorPage<GenerationJob>> listJobs({
    String? cursor,
    int limit = 20,
    GenerationJobStatus? status,
    String? templateId,
  });
  Future<GenerationJob> getJob(String id);
  Future<GenerationJob> cancelJob(String id);
  Future<GenerationAssetDelivery> getAssetDelivery(String assetId);
}

class ApiGenerationRepository implements GenerationRepository {
  ApiGenerationRepository(this._api);
  final ApiClient _api;

  @override
  Future<GenerationQuote> quote(GenerationSelection selection) => _api.post(
    '/generation/quotes',
    body: selection.toJson(),
    parser: (json) => GenerationQuote.fromJson(json as Map<String, dynamic>),
  );

  @override
  Future<GenerationJob> createJob({
    required GenerationSelection selection,
    required String quoteId,
    required String idempotencyKey,
  }) => _api.post(
    '/generation/jobs',
    headers: {'Idempotency-Key': idempotencyKey},
    body: {
      ...selection.toJson(),
      'quoteId': quoteId,
      'idempotencyKey': idempotencyKey,
    },
    parser: (json) => GenerationJob.fromJson(
      (json as Map<String, dynamic>)['job'] as Map<String, dynamic>,
    ),
  );

  @override
  Future<GenerationJob> getJob(String id) => _api.get(
    '/generation/jobs/${Uri.encodeComponent(id)}',
    parser: (json) => GenerationJob.fromJson(json as Map<String, dynamic>),
  );

  @override
  Future<CursorPage<GenerationJob>> listJobs({
    String? cursor,
    int limit = 20,
    GenerationJobStatus? status,
    String? templateId,
  }) => _api.get(
    '/generation/jobs',
    query: {
      'limit': limit,
      'cursor': ?cursor,
      if (status != null) 'status': _wireStatus(status),
      'templateId': ?templateId,
    },
    parser: (json) {
      final map = json as Map<String, dynamic>;
      return CursorPage(
        items: (map['items'] as List<dynamic>)
            .whereType<Map<String, dynamic>>()
            .map(GenerationJob.fromJson)
            .toList(growable: false),
        nextCursor: map['nextCursor'] as String?,
      );
    },
  );

  @override
  Future<GenerationJob> cancelJob(String id) => _api.post(
    '/generation/jobs/${Uri.encodeComponent(id)}/cancel',
    parser: (json) => GenerationJob.fromJson(json as Map<String, dynamic>),
  );

  @override
  Future<GenerationAssetDelivery> getAssetDelivery(String assetId) => _api.get(
    '/assets/generation/${Uri.encodeComponent(assetId)}',
    parser: (json) =>
        GenerationAssetDelivery.fromJson(json as Map<String, dynamic>),
  );
}

String _wireStatus(GenerationJobStatus value) => switch (value) {
  GenerationJobStatus.creditReserved => 'credit_reserved',
  GenerationJobStatus.providerProcessing => 'provider_processing',
  GenerationJobStatus.postProcessing => 'post_processing',
  _ => value.name,
};

final generationRepositoryProvider = Provider<GenerationRepository>((ref) {
  return ApiGenerationRepository(ref.watch(apiClientProvider));
});
