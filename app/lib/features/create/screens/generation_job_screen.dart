import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/models/generation.dart';
import '../../../core/repositories/generation_repository.dart';
import '../../../design_system/components/app_page.dart';
import '../../../design_system/components/error_state.dart';
import '../../../design_system/components/generation_stage_indicator.dart';
import '../../../design_system/components/media_preview_tile.dart';
import '../../../design_system/components/primary_action_button.dart';
import '../../../design_system/components/status_badge.dart';
import '../../../design_system/theme/app_theme.dart';
import '../../../design_system/tokens/app_spacing.dart';
import '../providers/generation_providers.dart';

class GenerationJobScreen extends ConsumerStatefulWidget {
  const GenerationJobScreen({super.key, required this.jobId});
  final String jobId;
  @override
  ConsumerState<GenerationJobScreen> createState() =>
      _GenerationJobScreenState();
}

class _GenerationJobScreenState extends ConsumerState<GenerationJobScreen> {
  bool _cancelling = false;
  String? _cancelError;
  @override
  Widget build(BuildContext context) {
    final job = ref.watch(generationJobProvider(widget.jobId));
    final tokens = context.appTokens;
    return Scaffold(
      backgroundColor: tokens.immersiveBackground,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: tokens.immersiveForeground,
        title: const Text('Generation'),
      ),
      body: AppPage(
        child: job.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => ErrorState(
            message:
                'We could not load this generation. It will keep running safely in the background.',
            onRetry: () => ref.invalidate(generationJobProvider(widget.jobId)),
          ),
          data: _content,
        ),
      ),
    );
  }

  Widget _content(GenerationJob job) {
    final tokens = context.appTokens;
    final secondary = tokens.immersiveMuted;
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
      children: [
        Center(
          child: StatusBadge(
            label: job.status.label,
            status: _appStatus(job.status),
            icon: job.status == GenerationJobStatus.completed
                ? Icons.check_rounded
                : Icons.auto_awesome_rounded,
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        if (job.status != GenerationJobStatus.failed &&
            job.status != GenerationJobStatus.cancelled)
          GenerationStageIndicator(
            labels: const [
              'Queued',
              'Creating',
              'Ingesting',
              'Finishing',
              'Ready',
            ],
            currentIndex: _stageIndex(job.status),
          ),
        const SizedBox(height: AppSpacing.xl),
        MediaPreviewTile(
          kind: job.status == GenerationJobStatus.completed
              ? MediaPreviewKind.video
              : MediaPreviewKind.progress,
          progress: job.progress / 100,
          selected: true,
          aspectRatio: 16 / 9,
        ),
        const SizedBox(height: AppSpacing.xl),
        Text(
          _headline(job),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
            color: tokens.immersiveForeground,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          _message(job),
          textAlign: TextAlign.center,
          style: Theme.of(
            context,
          ).textTheme.bodyLarge?.copyWith(color: secondary),
        ),
        const SizedBox(height: AppSpacing.lg),
        Semantics(
          label: '${job.progress} percent complete',
          child: Column(
            children: [
              LinearProgressIndicator(
                value: job.status == GenerationJobStatus.completed
                    ? 1
                    : job.progress / 100,
                minHeight: 8,
                borderRadius: BorderRadius.circular(8),
                backgroundColor: tokens.immersiveTrack,
                color: context.appTokens.generationEnd,
              ),
              const SizedBox(height: AppSpacing.xs),
              Align(
                alignment: Alignment.centerRight,
                child: Text(
                  '${job.progress}%',
                  style: Theme.of(
                    context,
                  ).textTheme.labelLarge?.copyWith(color: secondary),
                ),
              ),
            ],
          ),
        ),
        if (job.errorMessage != null) ...[
          const SizedBox(height: AppSpacing.lg),
          Text(
            job.errorMessage!,
            textAlign: TextAlign.center,
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(color: tokens.immersiveError),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Any reserved credits have been returned when the failure occurred before billable processing.',
            textAlign: TextAlign.center,
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: secondary),
          ),
        ],
        if (_cancelError != null) ...[
          const SizedBox(height: AppSpacing.md),
          Text(
            _cancelError!,
            textAlign: TextAlign.center,
            style: TextStyle(color: tokens.immersiveError),
          ),
        ],
        const SizedBox(height: AppSpacing.xl),
        if (job.status == GenerationJobStatus.completed)
          PrimaryActionButton(
            label: job.videoAssetId == null ? 'View in History' : 'Watch video',
            icon: job.videoAssetId == null
                ? Icons.video_library_outlined
                : Icons.play_circle_outline_rounded,
            style: PrimaryActionStyle.generation,
            onPressed: () => job.videoAssetId == null
                ? context.go('/history')
                : context.push(
                    '/generation/${job.id}/result/${job.videoAssetId}',
                  ),
          )
        else if (job.status.canCancel)
          OutlinedButton.icon(
            onPressed: _cancelling ? null : () => _cancel(job),
            icon: _cancelling
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.close_rounded),
            label: Text(
              _cancelling ? 'Cancelling' : 'Cancel and return credits',
            ),
            style: OutlinedButton.styleFrom(
              foregroundColor: tokens.immersiveForeground,
              side: BorderSide(color: tokens.immersiveTrack),
            ),
          ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          'You can leave this page. Production continues on Cloudflare and appears in History.',
          textAlign: TextAlign.center,
          style: Theme.of(
            context,
          ).textTheme.bodySmall?.copyWith(color: secondary),
        ),
      ],
    );
  }

  Future<void> _cancel(GenerationJob job) async {
    setState(() {
      _cancelling = true;
      _cancelError = null;
    });
    try {
      await ref.read(generationRepositoryProvider).cancelJob(job.id);
      ref.invalidate(generationJobProvider(job.id));
    } catch (_) {
      if (mounted) {
        setState(
          () => _cancelError =
              'This generation has progressed too far to cancel.',
        );
      }
    } finally {
      if (mounted) {
        setState(() => _cancelling = false);
      }
    }
  }

  String _headline(GenerationJob job) => switch (job.status) {
    GenerationJobStatus.completed => 'Your video is ready',
    GenerationJobStatus.failed => 'This video could not be completed',
    GenerationJobStatus.cancelled => 'Generation cancelled',
    _ => 'We are building your video',
  };

  String _message(GenerationJob job) => switch (job.status) {
    GenerationJobStatus.queued =>
      'Your production slot is reserved. You can still cancel now.',
    GenerationJobStatus.submitting =>
      'Sending your approved creative brief securely.',
    GenerationJobStatus.providerProcessing =>
      'Creating motion, composition, and visual details.',
    GenerationJobStatus.ingesting =>
      'Bringing the finished media into protected storage.',
    GenerationJobStatus.postProcessing ||
    GenerationJobStatus.rendering ||
    GenerationJobStatus.publishing =>
      'Applying the final polish and preparing delivery.',
    GenerationJobStatus.completed when job.videoAssetId != null =>
      'The final asset is stored and ready in your library.',
    GenerationJobStatus.completed =>
      'Final delivery is being attached to your library.',
    GenerationJobStatus.cancelled =>
      'Reserved credits were released to your balance.',
    GenerationJobStatus.failed =>
      'Review the message below. You can start a fresh generation from the template.',
    _ => 'Validating your choices and reserving production capacity.',
  };

  AppStatus _appStatus(GenerationJobStatus status) => switch (status) {
    GenerationJobStatus.completed => AppStatus.success,
    GenerationJobStatus.failed => AppStatus.error,
    GenerationJobStatus.cancelled => AppStatus.neutral,
    _ => AppStatus.generating,
  };

  int _stageIndex(GenerationJobStatus status) => switch (status) {
    GenerationJobStatus.draft ||
    GenerationJobStatus.validating ||
    GenerationJobStatus.creditReserved ||
    GenerationJobStatus.queued ||
    GenerationJobStatus.cancelled ||
    GenerationJobStatus.failed => 0,
    GenerationJobStatus.submitting ||
    GenerationJobStatus.providerProcessing => 1,
    GenerationJobStatus.ingesting => 2,
    GenerationJobStatus.postProcessing ||
    GenerationJobStatus.rendering ||
    GenerationJobStatus.publishing => 3,
    GenerationJobStatus.completed => 4,
  };
}
