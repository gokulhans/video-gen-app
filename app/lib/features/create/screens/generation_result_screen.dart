import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

import '../../../core/api_client.dart';
import '../../../core/models/generation.dart';
import '../../../design_system/components/app_page.dart';
import '../../../design_system/components/error_state.dart';
import '../../../design_system/tokens/app_spacing.dart';
import '../providers/generation_providers.dart';

class GenerationResultScreen extends ConsumerStatefulWidget {
  const GenerationResultScreen({
    super.key,
    required this.jobId,
    required this.assetId,
  });

  final String jobId;
  final String assetId;

  @override
  ConsumerState<GenerationResultScreen> createState() =>
      _GenerationResultScreenState();
}

class _GenerationResultScreenState
    extends ConsumerState<GenerationResultScreen> {
  VideoPlayerController? _video;
  String? _initializedUrl;
  String? _playbackError;
  String? _localPath;
  bool _transferring = false;

  @override
  void dispose() {
    _video?.dispose();
    super.dispose();
  }

  Future<void> _initialize(String url) async {
    if (_initializedUrl == url) return;
    _initializedUrl = url;
    final previous = _video;
    final next = VideoPlayerController.networkUrl(Uri.parse(url));
    try {
      await next.initialize();
      await next.play();
      if (!mounted) {
        await next.dispose();
        return;
      }
      setState(() {
        _video = next;
        _playbackError = null;
      });
      await previous?.dispose();
    } catch (_) {
      await next.dispose();
      if (mounted) {
        setState(() => _playbackError = 'Playback could not be started.');
      }
    }
  }

  Future<String> _download(String url) async {
    final existing = _localPath;
    if (existing != null) return existing;
    final directory = await getApplicationDocumentsDirectory();
    final path = '${directory.path}/ai_video_${widget.jobId}.mp4';
    await ref.read(apiClientProvider).download(url, path);
    _localPath = path;
    return path;
  }

  Future<void> _save(GenerationAssetDelivery delivery) async {
    final url = delivery.downloadUrl;
    if (url == null) return;
    setState(() => _transferring = true);
    try {
      final path = await _download(url);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Saved securely to $path')));
      }
    } catch (_) {
      _showTransferError();
    } finally {
      if (mounted) setState(() => _transferring = false);
    }
  }

  Future<void> _share(GenerationAssetDelivery delivery) async {
    final url = delivery.downloadUrl;
    if (url == null) return;
    setState(() => _transferring = true);
    try {
      final path = await _download(url);
      await Share.shareXFiles([
        XFile(path, mimeType: 'video/mp4'),
      ], text: 'Created with AI Video');
    } catch (_) {
      _showTransferError();
    } finally {
      if (mounted) setState(() => _transferring = false);
    }
  }

  void _showTransferError() {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('The secure link expired. Refresh and try again.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final delivery = ref.watch(generationAssetDeliveryProvider(widget.assetId));
    return Scaffold(
      appBar: AppBar(title: const Text('Your video')),
      body: AppPage(
        child: delivery.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, _) => ErrorState(
            message: 'The secure playback link could not be created.',
            onRetry: () =>
                ref.invalidate(generationAssetDeliveryProvider(widget.assetId)),
          ),
          data: (asset) {
            final playbackUrl = asset.playbackUrl;
            if (playbackUrl == null) {
              return const ErrorState(
                message: 'This video does not have a playable delivery yet.',
              );
            }
            _initialize(playbackUrl);
            return ListView(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
              children: [
                AspectRatio(
                  aspectRatio: _video?.value.isInitialized == true
                      ? _video!.value.aspectRatio
                      : 16 / 9,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: ColoredBox(
                      color: Colors.black,
                      child: _playbackError != null
                          ? Center(
                              child: TextButton(
                                onPressed: () {
                                  _initializedUrl = null;
                                  ref.invalidate(
                                    generationAssetDeliveryProvider(
                                      widget.assetId,
                                    ),
                                  );
                                },
                                child: const Text('Refresh secure playback'),
                              ),
                            )
                          : _video?.value.isInitialized == true
                          ? Stack(
                              alignment: Alignment.bottomCenter,
                              children: [
                                Center(child: VideoPlayer(_video!)),
                                VideoProgressIndicator(
                                  _video!,
                                  allowScrubbing: true,
                                  padding: const EdgeInsets.only(top: 12),
                                ),
                              ],
                            )
                          : const Center(child: CircularProgressIndicator()),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _transferring || asset.downloadUrl == null
                          ? null
                          : () => _save(asset),
                      icon: const Icon(Icons.download_outlined),
                      label: const Text('Download master'),
                    ),
                    FilledButton.icon(
                      onPressed: _transferring || asset.downloadUrl == null
                          ? null
                          : () => _share(asset),
                      icon: const Icon(Icons.share_outlined),
                      label: const Text('Share video'),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Playback and download links are private and expire automatically.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
