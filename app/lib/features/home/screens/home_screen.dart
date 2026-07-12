import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/models/catalog.dart';
import '../../../design_system/components/app_page.dart';
import '../../../design_system/components/empty_state.dart';
import '../../../design_system/components/error_state.dart';
import '../../../design_system/components/media_preview_tile.dart';
import '../../../design_system/components/primary_action_button.dart';
import '../../../design_system/components/section_card.dart';
import '../../../design_system/components/skeleton_box.dart';
import '../../../design_system/tokens/app_spacing.dart';
import '../../catalog/providers/catalog_providers.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalog = ref.watch(catalogCategoriesProvider);
    return AppPage(
      child: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(catalogCategoriesProvider);
          await ref.read(catalogCategoriesProvider.future);
        },
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xl)),
            SliverToBoxAdapter(
              child: _Hero(
                onExplore: () => _openFirst(context, catalog.valueOrNull),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xxl)),
            ...catalog.when(
              skipLoadingOnRefresh: true,
              loading: () => const [_CatalogSkeleton()],
              error: (error, stack) => [
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 380,
                    child: ErrorState(
                      message:
                          'The template studio is temporarily unavailable. Your existing projects are still safe.',
                      onRetry: () => ref.invalidate(catalogCategoriesProvider),
                    ),
                  ),
                ),
              ],
              data: (categories) => categories.isEmpty
                  ? const [
                      SliverToBoxAdapter(
                        child: SizedBox(
                          height: 380,
                          child: EmptyState(
                            icon: Icons.video_collection_outlined,
                            title: 'New formats are on the way',
                            message:
                                'The studio team has not published any templates yet. Pull down to check again.',
                          ),
                        ),
                      ),
                    ]
                  : [
                      for (final category in categories)
                        _CategorySection(category: category),
                    ],
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xxl)),
          ],
        ),
      ),
    );
  }

  void _openFirst(BuildContext context, List<CatalogCategory>? categories) {
    final template = categories
        ?.expand((category) => category.templates)
        .firstOrNull;
    if (template != null) context.push('/templates/${template.slug}');
  }
}

class _Hero extends StatelessWidget {
  const _Hero({required this.onExplore});
  final VoidCallback onExplore;
  @override
  Widget build(BuildContext context) => SectionCard(
    raised: true,
    child: LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 620;
        final copy = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'VIDEO STUDIO',
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: Theme.of(context).colorScheme.primary,
                letterSpacing: 1.4,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Turn one business idea into your next campaign.',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Choose a proven format, make it yours, and let AI handle production.',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            PrimaryActionButton(
              label: 'Choose a format',
              icon: Icons.auto_awesome_rounded,
              style: PrimaryActionStyle.generation,
              expand: false,
              onPressed: onExplore,
            ),
          ],
        );
        const art = MediaPreviewTile(
          kind: MediaPreviewKind.video,
          selected: true,
          aspectRatio: 16 / 10,
        );
        return wide
            ? Row(
                children: [
                  Expanded(flex: 3, child: copy),
                  const SizedBox(width: AppSpacing.xl),
                  const Expanded(flex: 2, child: art),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 154, child: art),
                  const SizedBox(height: AppSpacing.lg),
                  copy,
                ],
              );
      },
    ),
  );
}

class _CategorySection extends StatelessWidget {
  const _CategorySection({required this.category});
  final CatalogCategory category;
  @override
  Widget build(BuildContext context) => SliverMainAxisGroup(
    slivers: [
      SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.only(
            top: AppSpacing.md,
            bottom: AppSpacing.sm,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                category.name,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              if (category.description != null) ...[
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  category.description!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      SliverToBoxAdapter(
        child: LayoutBuilder(
          builder: (context, constraints) {
            if (constraints.maxWidth >= 760) {
              final columns = (constraints.maxWidth / 245).floor().clamp(3, 4);
              return GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: columns,
                  crossAxisSpacing: AppSpacing.md,
                  mainAxisSpacing: AppSpacing.md,
                  childAspectRatio: .78,
                ),
                itemCount: category.templates.length,
                itemBuilder: (context, index) => _TemplateCard(
                  template: category.templates[index],
                  expand: true,
                ),
              );
            }
            return SizedBox(
              height: 246,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: category.templates.length,
                separatorBuilder: (_, _) =>
                    const SizedBox(width: AppSpacing.sm),
                itemBuilder: (context, index) =>
                    _TemplateCard(template: category.templates[index]),
              ),
            );
          },
        ),
      ),
    ],
  );
}

class _TemplateCard extends StatelessWidget {
  const _TemplateCard({required this.template, this.expand = false});
  final CatalogTemplate template;
  final bool expand;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: expand ? null : 190,
    child: Semantics(
      button: true,
      label: 'Open ${template.displayName}',
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => context.push('/templates/${template.slug}'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: template.previewUrl == null
                    ? const MediaPreviewTile(
                        kind: MediaPreviewKind.video,
                        aspectRatio: 16 / 10,
                      )
                    : CachedNetworkImage(
                        imageUrl: template.previewUrl!,
                        fit: BoxFit.cover,
                        errorWidget: (_, _, _) => const MediaPreviewTile(
                          kind: MediaPreviewKind.video,
                        ),
                      ),
              ),
              Padding(
                padding: const EdgeInsets.all(AppSpacing.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      template.displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    const SizedBox(height: AppSpacing.xxs),
                    Text(
                      template.description ?? 'Ready to customize',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _CatalogSkeleton extends StatelessWidget {
  const _CatalogSkeleton();
  @override
  Widget build(BuildContext context) => SliverList.list(
    children: const [
      SkeletonBox(height: 26, width: 180),
      SizedBox(height: AppSpacing.sm),
      SizedBox(
        height: 220,
        child: Row(
          children: [
            Expanded(child: SkeletonBox(height: 220)),
            SizedBox(width: AppSpacing.sm),
            Expanded(child: SkeletonBox(height: 220)),
          ],
        ),
      ),
      SizedBox(height: AppSpacing.xl),
      SkeletonBox(height: 26, width: 140),
      SizedBox(height: AppSpacing.sm),
      SkeletonBox(height: 220),
    ],
  );
}
