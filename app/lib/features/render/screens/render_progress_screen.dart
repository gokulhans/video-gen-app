import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/models/composition.dart';
import '../providers/render_providers.dart';

/// Render progress screen: WebSocket to /render-jobs/:id/ws with a polling
/// fallback (see [RenderProgressController]), then navigates to playback.
class RenderProgressScreen extends ConsumerWidget {
  const RenderProgressScreen({super.key, required this.jobId});

  final String jobId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final jobAsync = ref.watch(renderProgressControllerProvider(jobId));

    ref.listen(renderProgressControllerProvider(jobId), (previous, next) {
      final job = next.valueOrNull;
      if (job != null && job.status == RenderStatus.completed) {
        context.go('/render/result/$jobId');
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('Rendering'),
        automaticallyImplyLeading: false,
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: jobAsync.when(
          data: (job) {
            if (job.status == RenderStatus.failed) {
              return _FailureView(
                error: job.error ?? 'Render failed unexpectedly.',
                onRetry: () => context.pop(),
              );
            }
            return Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.movie_filter_outlined,
                  size: 56,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(height: 24),
                Text(
                  _statusLabel(job.status),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 24),
                LinearProgressIndicator(value: job.progress / 100),
                const SizedBox(height: 8),
                Text('${job.progress.round()}%'),
              ],
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) =>
              _FailureView(error: '$error', onRetry: () => context.pop()),
        ),
      ),
    );
  }

  String _statusLabel(RenderStatus status) => switch (status) {
    RenderStatus.queued => 'Queued...',
    RenderStatus.starting => 'Starting renderer...',
    RenderStatus.rendering => 'Rendering your video...',
    RenderStatus.uploading => 'Uploading final video...',
    RenderStatus.completed => 'Done!',
    RenderStatus.failed => 'Failed',
  };
}

class _FailureView extends StatelessWidget {
  const _FailureView({required this.error, required this.onRetry});

  final String error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 56, color: Colors.red),
          const SizedBox(height: 16),
          Text('Render failed', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text(error, textAlign: TextAlign.center),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Back'),
          ),
        ],
      ),
    );
  }
}
