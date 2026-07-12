import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/api_client.dart';
import '../../../core/models/composition.dart';
import '../../../core/repositories/asset_repository.dart';
import '../../../core/repositories/project_repository.dart';
import '../../../core/repositories/token_repository.dart';
import '../providers/editor_providers.dart';

/// Images tab: scene grid, regenerate button (shows token cost first), and
/// replace-from-gallery using the presigned upload-url flow.
class ImagesTab extends ConsumerWidget {
  const ImagesTab({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final compositionAsync = ref.watch(
      compositionControllerProvider(projectId),
    );

    return compositionAsync.when(
      data: (composition) => GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          mainAxisSpacing: 16,
          crossAxisSpacing: 16,
          childAspectRatio: 0.72,
        ),
        itemCount: composition.scenes.length,
        itemBuilder: (context, index) {
          final scene = composition.scenes[index];
          return _SceneImageCard(projectId: projectId, scene: scene);
        },
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('$error')),
    );
  }
}

class _SceneImageCard extends ConsumerStatefulWidget {
  const _SceneImageCard({required this.projectId, required this.scene});

  final String projectId;
  final Scene scene;

  @override
  ConsumerState<_SceneImageCard> createState() => _SceneImageCardState();
}

class _SceneImageCardState extends ConsumerState<_SceneImageCard> {
  bool _busy = false;

  Future<void> _regenerate() async {
    final estimate = await ref
        .read(tokenRepositoryProvider)
        .getActionCostEstimate('image_generation');
    if (!mounted) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Regenerate image'),
        content: Text('This will use ${estimate.total} tokens. Continue?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Regenerate'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _busy = true);
    final controller = ref.read(
      compositionControllerProvider(widget.projectId).notifier,
    );
    controller.setSceneRegenerating(widget.scene.id);
    try {
      final updatedScene = await ref
          .read(projectRepositoryProvider)
          .regenerateSceneImage(widget.projectId, widget.scene.id);
      controller.updateSceneImage(
        widget.scene.id,
        imageUrl: updatedScene.imageUrl,
        status: updatedScene.imageStatus,
      );
    } on ApiException catch (e) {
      controller.updateSceneImage(widget.scene.id, status: ImageStatus.failed);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              e.isInsufficientTokens
                  ? 'Not enough tokens to regenerate this image'
                  : e.message,
            ),
          ),
        );
      }
    } catch (e) {
      controller.updateSceneImage(widget.scene.id, status: ImageStatus.failed);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Regenerate failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _replaceFromGallery() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 90,
    );
    if (file == null) return;

    setState(() => _busy = true);
    final controller = ref.read(
      compositionControllerProvider(widget.projectId).notifier,
    );
    controller.setSceneRegenerating(widget.scene.id);
    try {
      final assetRepo = ref.read(assetRepositoryProvider);
      final contentType = file.name.toLowerCase().endsWith('.png')
          ? 'image/png'
          : 'image/jpeg';
      final sizeBytes = await file.length();
      if (sizeBytes > 15 * 1024 * 1024) {
        throw ApiException(
          'FILE_TOO_LARGE',
          'Images must be smaller than 15 MB',
        );
      }
      final presigned = await assetRepo.getUploadUrl(
        kind: 'image',
        contentType: contentType,
        sizeBytes: sizeBytes,
      );

      final uploadDio = Dio(
        BaseOptions(
          connectTimeout: const Duration(seconds: 20),
          sendTimeout: const Duration(minutes: 2),
        ),
      );
      await uploadDio.put(
        presigned.uploadUrl,
        data: file.openRead(),
        options: Options(
          headers: {'Content-Type': contentType, 'Content-Length': sizeBytes},
        ),
      );

      controller.updateSceneImage(
        widget.scene.id,
        imageUrl: presigned.publicUrl,
        status: ImageStatus.ready,
      );
    } catch (e) {
      controller.updateSceneImage(widget.scene.id, status: ImageStatus.failed);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Upload failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scene = widget.scene;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (scene.imageUrl != null)
                  CachedNetworkImage(
                    imageUrl: scene.imageUrl!,
                    fit: BoxFit.cover,
                    errorWidget: (_, __, ___) => _placeholder(context),
                  )
                else
                  _placeholder(context),
                if (scene.imageStatus == ImageStatus.generating || _busy)
                  Container(
                    color: Colors.black45,
                    child: const Center(
                      child: CircularProgressIndicator(color: Colors.white),
                    ),
                  ),
                if (scene.imageStatus == ImageStatus.failed && !_busy)
                  Positioned(
                    top: 8,
                    left: 8,
                    child: Chip(
                      label: const Text(
                        'Failed',
                        style: TextStyle(fontSize: 11),
                      ),
                      backgroundColor: Colors.red.withValues(alpha: 0.8),
                      labelStyle: const TextStyle(color: Colors.white),
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: Text(
              'Scene ${scene.order + 1}',
              style: Theme.of(context).textTheme.labelMedium,
            ),
          ),
          Row(
            children: [
              Expanded(
                child: IconButton(
                  tooltip: 'Regenerate',
                  onPressed: _busy ? null : _regenerate,
                  icon: const Icon(Icons.autorenew, size: 20),
                ),
              ),
              Expanded(
                child: IconButton(
                  tooltip: 'Replace from gallery',
                  onPressed: _busy ? null : _replaceFromGallery,
                  icon: const Icon(Icons.photo_library_outlined, size: 20),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _placeholder(BuildContext context) => Container(
    color: Theme.of(context).colorScheme.surfaceContainerHighest,
    child: const Icon(Icons.image_outlined, size: 40),
  );
}
