import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api_client.dart';
import '../../../core/repositories/project_repository.dart';
import '../providers/editor_providers.dart';

/// Script tab: edit the full script and per-scene text, with an AI rewrite
/// button (`POST /projects/:id/script/rewrite`).
class ScriptTab extends ConsumerStatefulWidget {
  const ScriptTab({super.key, required this.projectId});

  final String projectId;

  @override
  ConsumerState<ScriptTab> createState() => _ScriptTabState();
}

class _ScriptTabState extends ConsumerState<ScriptTab> {
  bool _rewriting = false;
  final _instructionController = TextEditingController();

  @override
  void dispose() {
    _instructionController.dispose();
    super.dispose();
  }

  Future<void> _rewrite() async {
    setState(() => _rewriting = true);
    try {
      final repo = ref.read(projectRepositoryProvider);
      final rewritten = await repo.rewriteScript(
        widget.projectId,
        instruction: _instructionController.text.trim().isEmpty
            ? null
            : _instructionController.text.trim(),
      );
      ref
          .read(compositionControllerProvider(widget.projectId).notifier)
          .replaceComposition(rewritten);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Script rewritten (tokens deducted)')),
        );
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              e.isInsufficientTokens
                  ? 'Not enough tokens to rewrite the script'
                  : e.message,
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Rewrite failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _rewriting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final compositionAsync = ref.watch(
      compositionControllerProvider(widget.projectId),
    );
    final controller = ref.read(
      compositionControllerProvider(widget.projectId).notifier,
    );

    return compositionAsync.when(
      data: (composition) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Full script', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          TextFormField(
            initialValue: composition.script,
            maxLines: 8,
            onChanged: controller.updateScript,
            decoration: const InputDecoration(hintText: 'Video script...'),
          ),
          const SizedBox(height: 12),
          Card(
            color: Theme.of(context).colorScheme.secondaryContainer,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'AI rewrite',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _instructionController,
                    decoration: const InputDecoration(
                      hintText:
                          'e.g. "Make it punchier" or "Add a call to action"',
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.icon(
                      onPressed: _rewriting ? null : _rewrite,
                      icon: _rewriting
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.auto_fix_high, size: 18),
                      label: const Text('Rewrite script'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          Text('Scenes', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          ...composition.scenes.map(
            (scene) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Scene ${scene.order + 1} · ${scene.start.toStringAsFixed(1)}s-${scene.end.toStringAsFixed(1)}s',
                        style: Theme.of(context).textTheme.labelMedium,
                      ),
                      const SizedBox(height: 6),
                      TextFormField(
                        key: ValueKey('scene-text-${scene.id}'),
                        initialValue: scene.text,
                        maxLines: 3,
                        onChanged: (value) =>
                            controller.updateSceneText(scene.id, value),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('$error')),
    );
  }
}
