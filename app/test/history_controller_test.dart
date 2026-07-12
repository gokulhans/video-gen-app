import 'package:ai_video_maker/core/models/generation.dart';
import 'package:ai_video_maker/core/repositories/generation_repository.dart';
import 'package:ai_video_maker/features/history/providers/history_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'history controller appends cursor pages without losing items',
    () async {
      final repository = _PagedRepository();
      final container = ProviderContainer(
        overrides: [generationRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);

      final initial = await container.read(historyProvider.future);
      expect(initial.jobs.map((job) => job.id), ['job-1']);
      expect(initial.hasMore, isTrue);

      await container.read(historyProvider.notifier).loadMore();
      final loaded = container.read(historyProvider).requireValue;
      expect(loaded.jobs.map((job) => job.id), ['job-1', 'job-2']);
      expect(loaded.hasMore, isFalse);
    },
  );
}

class _PagedRepository implements GenerationRepository {
  @override
  Future<CursorPage<GenerationJob>> listJobs({
    String? cursor,
    int limit = 20,
    GenerationJobStatus? status,
    String? templateId,
  }) async => cursor == null
      ? CursorPage(items: [_job('job-1')], nextCursor: 'next')
      : CursorPage(items: [_job('job-2')]);

  GenerationJob _job(String id) => GenerationJob(
    id: id,
    templateId: 'template',
    templateVersionId: 'version',
    status: GenerationJobStatus.completed,
    progress: 100,
    quotedCredits: 1,
    createdAt: DateTime(2026),
    updatedAt: DateTime(2026),
  );

  @override
  Future<GenerationJob> cancelJob(String id) => throw UnimplementedError();
  @override
  Future<GenerationJob> createJob({
    required GenerationSelection selection,
    required String quoteId,
    required String idempotencyKey,
  }) => throw UnimplementedError();
  @override
  Future<GenerationJob> getJob(String id) => throw UnimplementedError();
  @override
  Future<GenerationQuote> quote(GenerationSelection selection) =>
      throw UnimplementedError();

  @override
  Future<GenerationAssetDelivery> getAssetDelivery(String assetId) =>
      throw UnimplementedError();
}
