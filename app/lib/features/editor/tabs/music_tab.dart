import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';

import '../providers/editor_providers.dart';

/// Music tab: volume slider, track sourced from the project's template.
class MusicTab extends ConsumerStatefulWidget {
  const MusicTab({super.key, required this.projectId});

  final String projectId;

  @override
  ConsumerState<MusicTab> createState() => _MusicTabState();
}

class _MusicTabState extends ConsumerState<MusicTab> {
  final AudioPlayer _player = AudioPlayer();
  bool _playing = false;

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _togglePlay(String url) async {
    if (_playing) {
      await _player.stop();
      setState(() => _playing = false);
      return;
    }
    await _player.setUrl(url);
    setState(() => _playing = true);
    await _player.play();
    _player.playerStateStream.listen((s) {
      if (s.processingState == ProcessingState.completed && mounted) {
        setState(() => _playing = false);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final compositionAsync = ref.watch(compositionControllerProvider(widget.projectId));
    final controller = ref.read(compositionControllerProvider(widget.projectId).notifier);

    return compositionAsync.when(
      data: (composition) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: Icon(composition.musicUrl == null
                  ? Icons.music_off_outlined
                  : (_playing ? Icons.stop_circle : Icons.play_circle_outline)),
              title: Text(composition.musicUrl == null ? 'No music track' : 'Template music track'),
              subtitle: composition.musicUrl != null ? const Text('Tap to preview') : null,
              onTap: composition.musicUrl != null ? () => _togglePlay(composition.musicUrl!) : null,
            ),
          ),
          const SizedBox(height: 24),
          Text(
            'Music volume: ${(composition.musicVolume * 100).round()}%',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          Slider(
            value: composition.musicVolume,
            onChanged: composition.musicUrl == null
                ? null
                : (value) => controller.updateMusic(musicVolume: value),
          ),
          const SizedBox(height: 12),
          Text(
            'Background music comes from your selected template. To use a '
            'different track, pick another template when creating a new video.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('$error')),
    );
  }
}
