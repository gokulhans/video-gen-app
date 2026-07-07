import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

import '../../../core/api_client.dart';
import '../providers/render_providers.dart';

/// Final playback screen: plays the rendered video, and offers Download
/// (via dio to app documents) and Share (WhatsApp-first via share_plus).
class VideoResultScreen extends ConsumerStatefulWidget {
  const VideoResultScreen({super.key, required this.jobId});

  final String jobId;

  @override
  ConsumerState<VideoResultScreen> createState() => _VideoResultScreenState();
}

class _VideoResultScreenState extends ConsumerState<VideoResultScreen> {
  VideoPlayerController? _controller;
  String? _initializedUrl;
  bool _downloading = false;
  String? _localPath;

  Future<void> _ensureInitialized(String url) async {
    if (_initializedUrl == url) return;
    _initializedUrl = url;
    final controller = VideoPlayerController.networkUrl(Uri.parse(url));
    await controller.initialize();
    controller.play();
    if (!mounted) {
      controller.dispose();
      return;
    }
    setState(() => _controller = controller);
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _download(String url) async {
    setState(() => _downloading = true);
    try {
      final directory = await getApplicationDocumentsDirectory();
      final fileName = 'ai_video_${widget.jobId}.mp4';
      final savePath = '${directory.path}/$fileName';
      final api = ref.read(apiClientProvider);
      await api.download(url, savePath);
      setState(() => _localPath = savePath);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Saved to $savePath')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Download failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  Future<void> _share(String url) async {
    try {
      // Prefer sharing the downloaded local file (works well with
      // WhatsApp's share sheet); fall back to sharing the remote link.
      var path = _localPath;
      if (path == null) {
        final directory = await getApplicationDocumentsDirectory();
        path = '${directory.path}/ai_video_${widget.jobId}.mp4';
        final api = ref.read(apiClientProvider);
        await api.download(url, path);
        _localPath = path;
      }
      // WhatsApp-first: shareXFiles surfaces the OS share sheet, on which
      // WhatsApp typically appears as one of the top targets for video
      // attachments; there is no supported "force WhatsApp" API on Android
      // without WhatsApp-specific intents, so we rely on the share sheet.
      await Share.shareXFiles(
        [XFile(path)],
        text: 'Check out this video I made with AI Video Maker!',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Share failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final jobAsync = ref.watch(renderProgressControllerProvider(widget.jobId));

    return Scaffold(
      appBar: AppBar(title: const Text('Your video')),
      body: jobAsync.when(
        data: (job) {
          final url = job.videoUrl;
          if (url == null) {
            return const Center(child: Text('Video not ready yet.'));
          }
          _ensureInitialized(url);
          return Column(
            children: [
              Expanded(
                child: Center(
                  child: _controller != null && _controller!.value.isInitialized
                      ? AspectRatio(
                          aspectRatio: _controller!.value.aspectRatio,
                          child: Stack(
                            alignment: Alignment.bottomCenter,
                            children: [
                              VideoPlayer(_controller!),
                              VideoProgressIndicator(_controller!, allowScrubbing: true),
                            ],
                          ),
                        )
                      : const CircularProgressIndicator(),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _downloading ? null : () => _download(url),
                        icon: _downloading
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.download_outlined),
                        label: const Text('Download'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: () => _share(url),
                        icon: const Icon(Icons.share_outlined),
                        label: const Text('Share'),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('$error')),
      ),
    );
  }
}
