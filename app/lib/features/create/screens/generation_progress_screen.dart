import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants.dart';
import '../../../core/models/composition.dart';
import '../../../core/models/project.dart';
import '../../../core/repositories/project_repository.dart';

const _stageOrder = [
  GenerationStage.script,
  GenerationStage.voice,
  GenerationStage.captions,
  GenerationStage.scenes,
  GenerationStage.images,
];

/// Polls `GET /projects/:id/generation-status` every 3s and renders a
/// per-stage progress UI (script -> voice -> captions -> scenes -> images),
/// with a friendly failure state and retry.
class GenerationProgressScreen extends ConsumerStatefulWidget {
  const GenerationProgressScreen({super.key, required this.projectId});

  final String projectId;

  @override
  ConsumerState<GenerationProgressScreen> createState() => _GenerationProgressScreenState();
}

class _GenerationProgressScreenState extends ConsumerState<GenerationProgressScreen> {
  Timer? _timer;
  GenerationStatusResponse? _status;
  Object? _error;
  bool _retrying = false;

  @override
  void initState() {
    super.initState();
    _poll();
    _timer = Timer.periodic(AppConstants.generationPollInterval, (_) => _poll());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _poll() async {
    try {
      final repo = ref.read(projectRepositoryProvider);
      final status = await repo.getGenerationStatus(widget.projectId);
      if (!mounted) return;
      setState(() {
        _status = status;
        _error = null;
      });
      if (status.status == GenerationStatus.complete) {
        _timer?.cancel();
      } else if (status.status == GenerationStatus.failed) {
        _timer?.cancel();
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    }
  }

  Future<void> _retry() async {
    setState(() => _retrying = true);
    try {
      final repo = ref.read(projectRepositoryProvider);
      await repo.retryGeneration(widget.projectId);
      setState(() {
        _status = null;
        _error = null;
      });
      _timer?.cancel();
      _timer = Timer.periodic(AppConstants.generationPollInterval, (_) => _poll());
      await _poll();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Retry failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _retrying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Generating your video'),
        automaticallyImplyLeading: false,
        actions: [
          TextButton(
            onPressed: () => context.go('/home'),
            child: const Text('Do this later'),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: status == null && _error == null
              ? const Center(child: CircularProgressIndicator())
              : status?.status == GenerationStatus.failed
                  ? _FailureView(
                      message: status?.error ?? 'Generation failed unexpectedly.',
                      retrying: _retrying,
                      onRetry: _retry,
                    )
                  : status?.status == GenerationStatus.complete
                      ? _CompleteView(
                          onOpen: () => context.go('/editor/${widget.projectId}'),
                        )
                      : _ProgressView(status: status, pollError: _error),
        ),
      ),
    );
  }
}

class _ProgressView extends StatelessWidget {
  const _ProgressView({required this.status, required this.pollError});

  final GenerationStatusResponse? status;
  final Object? pollError;

  @override
  Widget build(BuildContext context) {
    final currentStage = status?.stage ?? GenerationStage.script;
    final currentIndex = _stageOrder.indexOf(currentStage).clamp(0, _stageOrder.length - 1);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(Icons.auto_awesome, size: 56, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 16),
        Text(
          'Sit tight — this usually takes 1-2 minutes.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 32),
        for (var i = 0; i < _stageOrder.length; i++)
          _StageRow(
            stage: _stageOrder[i],
            state: i < currentIndex
                ? _StageState.done
                : i == currentIndex
                    ? _StageState.active
                    : _StageState.pending,
            progress: i == currentIndex ? status?.progress : null,
          ),
        if (pollError != null) ...[
          const SizedBox(height: 24),
          Text(
            'Having trouble refreshing status: $pollError',
            style: const TextStyle(color: Colors.orange),
            textAlign: TextAlign.center,
          ),
        ],
      ],
    );
  }
}

enum _StageState { pending, active, done }

class _StageRow extends StatelessWidget {
  const _StageRow({required this.stage, required this.state, this.progress});

  final GenerationStage stage;
  final _StageState state;
  final double? progress;

  @override
  Widget build(BuildContext context) {
    final icon = switch (state) {
      _StageState.done => const Icon(Icons.check_circle, color: Colors.green),
      _StageState.active => const SizedBox(
          width: 24,
          height: 24,
          child: CircularProgressIndicator(strokeWidth: 2.5),
        ),
      _StageState.pending => Icon(Icons.circle_outlined, color: Theme.of(context).disabledColor),
    };

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          SizedBox(width: 28, child: icon),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              stage.label,
              style: TextStyle(
                fontWeight: state == _StageState.active ? FontWeight.w700 : FontWeight.normal,
                color: state == _StageState.pending ? Theme.of(context).disabledColor : null,
              ),
            ),
          ),
          if (state == _StageState.active && progress != null)
            Text('${progress!.round()}%', style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _FailureView extends StatelessWidget {
  const _FailureView({required this.message, required this.retrying, required this.onRetry});

  final String message;
  final bool retrying;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.error_outline, size: 56, color: Colors.red),
        const SizedBox(height: 16),
        Text('Generation failed', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: retrying ? null : onRetry,
          icon: retrying
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.refresh),
          label: const Text('Retry generation'),
        ),
      ],
    );
  }
}

class _CompleteView extends StatelessWidget {
  const _CompleteView({required this.onOpen});

  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.check_circle, size: 56, color: Colors.green),
        const SizedBox(height: 16),
        Text('Your draft is ready!', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Text(
          'Review the script, images, and voice, then render your video.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: onOpen,
          icon: const Icon(Icons.edit_outlined),
          label: const Text('Open editor'),
        ),
      ],
    );
  }
}
