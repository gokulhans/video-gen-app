import 'package:ai_video_maker/core/models/catalog.dart';
import 'package:ai_video_maker/core/models/generation.dart';
import 'package:ai_video_maker/core/repositories/generation_repository.dart';
import 'package:ai_video_maker/features/catalog/providers/catalog_providers.dart';
import 'package:ai_video_maker/features/history/screens/history_screen.dart';
import 'package:ai_video_maker/features/home/screens/home_screen.dart';
import 'package:ai_video_maker/design_system/components/generation_stage_indicator.dart';
import 'package:ai_video_maker/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('compact History remains readable at 1.5x text', (tester) async {
    await tester.binding.setSurfaceSize(const Size(375, 812));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_app(const HistoryScreen(), textScale: 1.5));
    await tester.pumpAndSettle();

    expect(find.text('Campaign launch'), findsOneWidget);
    expect(find.text('Creating video'), findsOneWidget);
    expect(find.text('Completed'), findsWidgets);
    expect(find.text('Failed'), findsOneWidget);
    expect(find.text('3 credits'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('wide Home fills a responsive template grid', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1180, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_app(const HomeScreen()));
    await tester.pumpAndSettle();

    final first = tester.getTopLeft(find.text('Campaign launch'));
    final second = tester.getTopLeft(find.text('Product spotlight'));
    final third = tester.getTopLeft(find.text('Weekly offer'));
    expect((first.dy - second.dy).abs(), lessThan(2));
    expect((second.dy - third.dy).abs(), lessThan(2));
    expect(first.dx, lessThan(second.dx));
    expect(second.dx, lessThan(third.dx));
    expect(tester.takeException(), isNull);
  });

  testWidgets('generation stages wrap safely with large text', (tester) async {
    await tester.binding.setSurfaceSize(const Size(375, 300));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark,
        home: const MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(1.5)),
          child: Scaffold(
            body: Padding(
              padding: EdgeInsets.all(16),
              child: GenerationStageIndicator(
                labels: [
                  'Queued',
                  'Creating',
                  'Ingesting',
                  'Finishing',
                  'Ready',
                ],
                currentIndex: 2,
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text('Ingesting'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

Widget _app(Widget child, {double textScale = 1}) => ProviderScope(
  overrides: [
    catalogCategoriesProvider.overrideWith((ref) async => [_category]),
    generationRepositoryProvider.overrideWithValue(_HistoryRepository()),
  ],
  child: MaterialApp(
    theme: AppTheme.light,
    home: MediaQuery(
      data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
      child: Scaffold(body: child),
    ),
  ),
);

final _templates = [
  _template('t1', 'Campaign launch'),
  _template('t2', 'Product spotlight'),
  _template('t3', 'Weekly offer'),
  _template('t4', 'Brand story'),
];

final _category = CatalogCategory(
  id: 'category',
  slug: 'marketing',
  name: 'Marketing formats',
  order: 0,
  templates: _templates,
);

CatalogTemplate _template(String id, String name) => CatalogTemplate(
  id: 'version-$id',
  templateId: id,
  slug: id,
  version: 1,
  displayName: name,
  description: 'A practical business video format.',
  pipelineType: 'video',
  capabilities: const {},
  fields: const [],
);

class _HistoryRepository implements GenerationRepository {
  @override
  Future<CursorPage<GenerationJob>> listJobs({
    String? cursor,
    int limit = 20,
    GenerationJobStatus? status,
    String? templateId,
  }) async => CursorPage(
    items: [
      _job('t1', GenerationJobStatus.providerProcessing, 44),
      _job('t2', GenerationJobStatus.completed, 100),
      _job(
        't3',
        GenerationJobStatus.failed,
        18,
        error: 'The source file could not be processed.',
      ),
    ].where((job) => status == null || job.status == status).toList(),
  );

  GenerationJob _job(
    String templateId,
    GenerationJobStatus status,
    int progress, {
    String? error,
  }) => GenerationJob(
    id: 'job-$templateId',
    templateId: templateId,
    templateVersionId: 'version-$templateId',
    status: status,
    progress: progress,
    quotedCredits: 3,
    errorMessage: error,
    createdAt: DateTime(2026, 7, 12),
    updatedAt: DateTime(2026, 7, 12),
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
