import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/models/generation.dart';
import '../../../core/models/catalog.dart';
import '../../../design_system/components/app_page.dart';
import '../../../design_system/components/empty_state.dart';
import '../../../design_system/components/error_state.dart';
import '../../../design_system/components/media_preview_tile.dart';
import '../../../design_system/components/section_card.dart';
import '../../../design_system/components/skeleton_box.dart';
import '../../../design_system/components/status_badge.dart';
import '../../../design_system/tokens/app_spacing.dart';
import '../../catalog/providers/catalog_providers.dart';
import '../providers/history_providers.dart';

class HistoryScreen extends ConsumerWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(historyProvider);
    final wide = MediaQuery.sizeOf(context).width >= 840;
    final textScale = MediaQuery.textScalerOf(context).scale(1);
    final catalog = ref.watch(catalogCategoriesProvider).valueOrNull;
    final names = <String, String>{
      for (final template
          in catalog?.expand((item) => item.templates) ?? <CatalogTemplate>[])
        template.templateId: template.displayName,
    };
    return AppPage(
      child: RefreshIndicator(
        onRefresh: () => ref.read(historyProvider.notifier).refresh(),
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xl)),
            SliverToBoxAdapter(
              child: Text(
                'Your productions',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xs)),
            SliverToBoxAdapter(
              child: Text(
                'Every generation, from queue to final delivery.',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.lg)),
            if (history.valueOrNull != null)
              SliverToBoxAdapter(
                child: _Filters(
                  selected: history.value!.filter,
                  onSelected: (status) =>
                      ref.read(historyProvider.notifier).setFilter(status),
                ),
              ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.md)),
            ...history.when(
              loading: () => [
                SliverList.separated(
                  itemCount: 4,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, index) =>
                      const SkeletonBox(height: 126),
                ),
              ],
              error: (_, _) => [
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: ErrorState(
                    message: 'Your production history could not be loaded.',
                    onRetry: () => ref.read(historyProvider.notifier).refresh(),
                  ),
                ),
              ],
              data: (state) => state.jobs.isEmpty
                  ? [
                      SliverFillRemaining(
                        hasScrollBody: false,
                        child: EmptyState(
                          icon: Icons.movie_creation_outlined,
                          title: state.filter == null
                              ? 'No generations yet'
                              : 'Nothing in this status',
                          message: state.filter == null
                              ? 'Choose a format on Home to create your first AI video.'
                              : 'Try another filter or pull down to refresh.',
                          actionLabel: state.filter == null
                              ? 'Browse formats'
                              : null,
                          onAction: state.filter == null
                              ? () => context.go('/home')
                              : null,
                        ),
                      ),
                    ]
                  : [
                      if (wide)
                        SliverGrid(
                          gridDelegate:
                              SliverGridDelegateWithMaxCrossAxisExtent(
                                maxCrossAxisExtent: 540,
                                mainAxisExtent: textScale >= 1.3 ? 220 : 176,
                                crossAxisSpacing: AppSpacing.md,
                                mainAxisSpacing: AppSpacing.md,
                              ),
                          delegate: SliverChildBuilderDelegate(
                            (context, index) => _JobCard(
                              job: state.jobs[index],
                              templateName: names[state.jobs[index].templateId],
                            ),
                            childCount: state.jobs.length,
                          ),
                        )
                      else
                        SliverList.separated(
                          itemCount: state.jobs.length,
                          separatorBuilder: (context, index) =>
                              const SizedBox(height: AppSpacing.sm),
                          itemBuilder: (context, index) => _JobCard(
                            job: state.jobs[index],
                            templateName: names[state.jobs[index].templateId],
                          ),
                        ),
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            vertical: AppSpacing.lg,
                          ),
                          child: state.hasMore
                              ? Center(
                                  child: OutlinedButton.icon(
                                    onPressed: state.isLoadingMore
                                        ? null
                                        : () => ref
                                              .read(historyProvider.notifier)
                                              .loadMore(),
                                    icon: state.isLoadingMore
                                        ? const SizedBox.square(
                                            dimension: 18,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                            ),
                                          )
                                        : const Icon(Icons.expand_more_rounded),
                                    label: Text(
                                      state.isLoadingMore
                                          ? 'Loading'
                                          : state.loadMoreError
                                          ? 'Retry load more'
                                          : 'Load more',
                                    ),
                                  ),
                                )
                              : const _LegacyProjectsAction(),
                        ),
                      ),
                    ],
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xl)),
          ],
        ),
      ),
    );
  }
}

class _Filters extends StatelessWidget {
  const _Filters({required this.selected, required this.onSelected});
  final GenerationJobStatus? selected;
  final ValueChanged<GenerationJobStatus?> onSelected;
  @override
  Widget build(BuildContext context) {
    final entries = <(String, GenerationJobStatus?)>[
      ('All', null),
      ('Processing', GenerationJobStatus.providerProcessing),
      ('Completed', GenerationJobStatus.completed),
      ('Failed', GenerationJobStatus.failed),
      ('Cancelled', GenerationJobStatus.cancelled),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final entry in entries)
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.xs),
              child: ChoiceChip(
                label: Text(entry.$1),
                selected: selected == entry.$2,
                onSelected: (_) => onSelected(entry.$2),
              ),
            ),
        ],
      ),
    );
  }
}

class _JobCard extends StatelessWidget {
  const _JobCard({required this.job, this.templateName});
  final GenerationJob job;
  final String? templateName;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final largeText = MediaQuery.textScalerOf(context).scale(1) >= 1.3;
      final compressed = largeText || constraints.maxWidth < 380;
      return SectionCard(
        padding: EdgeInsets.zero,
        onTap: () => context.push('/generation/${job.id}'),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: compressed ? 74 : 92,
              height: compressed ? 112 : 126,
              child: MediaPreviewTile(
                kind: job.status == GenerationJobStatus.completed
                    ? MediaPreviewKind.video
                    : MediaPreviewKind.progress,
                progress: job.progress / 100,
                aspectRatio: 9 / 16,
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (compressed) ...[
                      Text(
                        templateName ?? 'AI video',
                        style: Theme.of(context).textTheme.titleMedium,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: StatusBadge(
                          label: job.status.label,
                          status: _status(job.status),
                        ),
                      ),
                    ] else
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              templateName ?? 'AI video',
                              style: Theme.of(context).textTheme.titleMedium,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          StatusBadge(
                            label: job.status.label,
                            status: _status(job.status),
                          ),
                        ],
                      ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      DateFormat.yMMMd().add_jm().format(
                        job.createdAt.toLocal(),
                      ),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    if (!job.status.isTerminal)
                      LinearProgressIndicator(
                        value: job.progress / 100,
                        minHeight: 5,
                        borderRadius: BorderRadius.circular(5),
                      ),
                    if (job.errorMessage != null)
                      Text(
                        job.errorMessage!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      '${job.quotedCredits} credits',
                      style: Theme.of(context).textTheme.labelMedium,
                    ),
                  ],
                ),
              ),
            ),
            if (!compressed)
              const Padding(
                padding: EdgeInsets.only(right: AppSpacing.sm),
                child: Icon(Icons.chevron_right_rounded),
              ),
          ],
        ),
      );
    },
  );

  static AppStatus _status(GenerationJobStatus value) => switch (value) {
    GenerationJobStatus.completed => AppStatus.success,
    GenerationJobStatus.failed => AppStatus.error,
    GenerationJobStatus.cancelled => AppStatus.neutral,
    _ => AppStatus.generating,
  };
}

class _LegacyProjectsAction extends StatelessWidget {
  const _LegacyProjectsAction();
  @override
  Widget build(BuildContext context) => TextButton.icon(
    onPressed: () => context.push('/legacy/projects'),
    icon: const Icon(Icons.folder_outlined),
    label: const Text('Legacy projects'),
  );
}
