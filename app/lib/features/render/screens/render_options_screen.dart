import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api_client.dart';
import '../../../core/models/render_job.dart';
import '../../../core/repositories/render_repository.dart';
import '../providers/render_providers.dart';

/// Resolution choice screen: 720p / 1080p with token costs shown up front.
class RenderOptionsScreen extends ConsumerStatefulWidget {
  const RenderOptionsScreen({super.key, required this.projectId});

  final String projectId;

  @override
  ConsumerState<RenderOptionsScreen> createState() =>
      _RenderOptionsScreenState();
}

class _RenderOptionsScreenState extends ConsumerState<RenderOptionsScreen> {
  RenderResolution _resolution = RenderResolution.p720;
  bool _starting = false;

  Future<void> _startRender() async {
    setState(() => _starting = true);
    try {
      final job = await ref
          .read(renderRepositoryProvider)
          .startRender(widget.projectId, _resolution);
      if (mounted) {
        context.push('/render/progress/${job.id}');
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              e.isInsufficientTokens
                  ? 'Not enough tokens to render this video'
                  : e.message,
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Could not start render: $e')));
      }
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Render video')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Choose a resolution',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          _ResolutionTile(
            resolution: RenderResolution.p720,
            selected: _resolution == RenderResolution.p720,
            onSelected: () =>
                setState(() => _resolution = RenderResolution.p720),
          ),
          const SizedBox(height: 12),
          _ResolutionTile(
            resolution: RenderResolution.p1080,
            selected: _resolution == RenderResolution.p1080,
            onSelected: () =>
                setState(() => _resolution = RenderResolution.p1080),
          ),
          const SizedBox(height: 32),
          FilledButton.icon(
            onPressed: _starting ? null : _startRender,
            icon: _starting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.movie_creation_outlined),
            label: const Text('Start render'),
          ),
        ],
      ),
    );
  }
}

class _ResolutionTile extends ConsumerWidget {
  const _ResolutionTile({
    required this.resolution,
    required this.selected,
    required this.onSelected,
  });

  final RenderResolution resolution;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final costAsync = ref.watch(renderCostEstimateProvider(resolution));
    return Card(
      color: selected ? Theme.of(context).colorScheme.primaryContainer : null,
      child: RadioListTile<RenderResolution>(
        value: resolution,
        groupValue: selected ? resolution : null,
        onChanged: (_) => onSelected(),
        title: Text(resolution.label),
        subtitle: costAsync.when(
          data: (estimate) => Text('${estimate.total} tokens'),
          loading: () => const Text('Estimating...'),
          error: (_, __) => const Text('Cost unavailable'),
        ),
      ),
    );
  }
}
