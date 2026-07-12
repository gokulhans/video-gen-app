import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../design_system/components/app_page.dart';
import '../../../design_system/components/empty_state.dart';
import '../../../design_system/components/error_state.dart';
import '../../../design_system/components/skeleton_box.dart';
import '../../../design_system/tokens/app_spacing.dart';
import '../../home/providers/home_providers.dart';
import '../../home/widgets/project_card.dart';

class LegacyProjectsScreen extends ConsumerWidget {
  const LegacyProjectsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projects = ref.watch(projectListProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Legacy projects')),
      body: AppPage(
        child: projects.when(
          loading: () => ListView.separated(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
            itemCount: 4,
            separatorBuilder: (context, index) =>
                const SizedBox(height: AppSpacing.sm),
            itemBuilder: (context, index) => const SkeletonBox(height: 112),
          ),
          error: (_, _) => ErrorState(
            message: 'Legacy projects are unavailable right now.',
            onRetry: () => ref.invalidate(projectListProvider),
          ),
          data: (items) => items.isEmpty
              ? const EmptyState(
                  icon: Icons.folder_open_rounded,
                  title: 'No legacy projects',
                  message:
                      'Projects from the original editor will remain available here.',
                )
              : ListView.separated(
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
                  itemCount: items.length,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, index) => ProjectCard(
                    project: items[index],
                    onTap: () => context.push('/editor/${items[index].id}'),
                  ),
                ),
        ),
      ),
    );
  }
}
