import 'package:ai_video_maker/core/models/catalog.dart';
import 'package:ai_video_maker/core/models/generation.dart';
import 'package:ai_video_maker/core/repositories/generation_repository.dart';
import 'package:ai_video_maker/features/create/providers/generation_providers.dart';
import 'package:ai_video_maker/features/create/screens/generation_job_screen.dart';
import 'package:ai_video_maker/design_system/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('catalog parser rejects unknown input types safely', () {
    final field = CatalogInputDefinition.fromJson({
      'id': 'field-1',
      'key': 'dangerous',
      'type': 'server_script',
      'label': 'Unsupported',
      'required': false,
      'order': 1,
      'code': 'doNotRun()',
    });

    expect(field.type, CatalogInputType.unavailable);
    expect(field.isSupported, isFalse);
  });

  test('generation status parses wire names and cancellation rules', () {
    final job = GenerationJob.fromJson(_jobJson(status: 'provider_processing'));
    expect(job.status, GenerationJobStatus.providerProcessing);
    expect(job.status.canCancel, isFalse);
    expect(
      GenerationJob.fromJson(_jobJson(status: 'queued')).status.canCancel,
      isTrue,
    );
  });

  test('submission retries reuse one idempotency key', () async {
    final repository = _FakeGenerationRepository(failFirstSubmission: true);
    final controller = GenerationSubmissionController(repository);
    const selection = GenerationSelection(
      templateVersionId: 'version-1',
      inputs: {'prompt': 'A new menu launch'},
    );

    await controller.requestQuote(selection);
    expect(await controller.submitQuotedJob(), isNull);
    expect(await controller.submitQuotedJob(), isNotNull);

    expect(repository.idempotencyKeys, hasLength(2));
    expect(repository.idempotencyKeys.toSet(), hasLength(1));
  });

  test(
    'job polling cancels its timer when the last listener disposes',
    () async {
      final repository = _FakeGenerationRepository();
      final container = ProviderContainer(
        overrides: [
          generationRepositoryProvider.overrideWithValue(repository),
          generationPollBaseIntervalProvider.overrideWithValue(
            const Duration(milliseconds: 10),
          ),
        ],
      );
      addTearDown(container.dispose);
      final subscription = container.listen(
        generationJobProvider('job-1'),
        (previous, next) {},
        fireImmediately: true,
      );
      await Future<void>.delayed(const Duration(milliseconds: 35));
      subscription.close();
      await Future<void>.delayed(const Duration(milliseconds: 5));
      final countAtDispose = repository.getJobCalls;
      await Future<void>.delayed(const Duration(milliseconds: 40));

      expect(repository.getJobCalls, countAtDispose);
    },
  );

  testWidgets('completed generation offers its ready video to the user', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(375, 812));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final repository = _FakeGenerationRepository(completedJob: true);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          generationRepositoryProvider.overrideWithValue(repository),
        ],
        child: MaterialApp(
          theme: AppTheme.dark,
          home: const GenerationJobScreen(jobId: 'job-1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Your video is ready'), findsOneWidget);
    expect(
      find.text('The final asset is stored and ready in your library.'),
      findsOneWidget,
    );
    expect(find.text('Watch video'), findsOneWidget);
    expect(find.text('100%'), findsOneWidget);
    expect(find.textContaining('Cancel and return credits'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}

Map<String, dynamic> _jobJson({
  String status = 'queued',
  int progress = 20,
  String? videoAssetId,
}) => {
  'id': 'job-1',
  'templateId': 'template-1',
  'templateVersionId': 'version-1',
  'status': status,
  'progress': progress,
  'quotedCredits': 2,
  'previewAssetId': null,
  'videoAssetId': videoAssetId,
  'error': null,
  'createdAt': 1000,
  'updatedAt': 2000,
  'completedAt': null,
};

class _FakeGenerationRepository implements GenerationRepository {
  _FakeGenerationRepository({
    this.failFirstSubmission = false,
    this.completedJob = false,
  });
  final bool failFirstSubmission;
  final bool completedJob;
  final List<String> idempotencyKeys = [];
  int getJobCalls = 0;

  @override
  Future<GenerationQuote> quote(GenerationSelection selection) async =>
      GenerationQuote(
        quoteId: 'quote-1',
        templateVersionId: selection.templateVersionId,
        pricingVersionId: 'pricing-1',
        creditAmount: 2,
        estimatedMinSec: 10,
        estimatedMaxSec: 30,
        expiresAt: DateTime.now().add(const Duration(minutes: 5)),
      );

  @override
  Future<GenerationJob> createJob({
    required GenerationSelection selection,
    required String quoteId,
    required String idempotencyKey,
  }) async {
    idempotencyKeys.add(idempotencyKey);
    if (failFirstSubmission && idempotencyKeys.length == 1) {
      throw Exception('timeout');
    }
    return GenerationJob.fromJson(_jobJson());
  }

  @override
  Future<GenerationJob> cancelJob(String id) async =>
      GenerationJob.fromJson(_jobJson(status: 'cancelled'));

  @override
  Future<GenerationJob> getJob(String id) async {
    getJobCalls++;
    return GenerationJob.fromJson(
      completedJob
          ? _jobJson(
              status: 'completed',
              progress: 100,
              videoAssetId: 'asset-master',
            )
          : _jobJson(),
    );
  }

  @override
  Future<CursorPage<GenerationJob>> listJobs({
    String? cursor,
    int limit = 20,
    GenerationJobStatus? status,
    String? templateId,
  }) async => const CursorPage(items: []);

  @override
  Future<GenerationAssetDelivery> getAssetDelivery(String assetId) =>
      throw UnimplementedError();
}
