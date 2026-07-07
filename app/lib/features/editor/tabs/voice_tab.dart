import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';

import '../../../core/api_client.dart';
import '../../../core/repositories/project_repository.dart';
import '../../../core/repositories/template_repository.dart';
import '../providers/editor_providers.dart';

/// Voice tab: voice picker + regenerate voiceover
/// (`POST /projects/:id/voice/regenerate`).
class VoiceTab extends ConsumerStatefulWidget {
  const VoiceTab({super.key, required this.projectId});

  final String projectId;

  @override
  ConsumerState<VoiceTab> createState() => _VoiceTabState();
}

class _VoiceTabState extends ConsumerState<VoiceTab> {
  final AudioPlayer _player = AudioPlayer();
  bool _playingVoiceover = false;
  bool _regenerating = false;
  String? _playingSampleId;

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _toggleVoiceoverPlayback(String url) async {
    if (_playingVoiceover) {
      await _player.stop();
      setState(() => _playingVoiceover = false);
      return;
    }
    await _player.setUrl(url);
    setState(() => _playingVoiceover = true);
    await _player.play();
    _player.playerStateStream.listen((s) {
      if (s.processingState == ProcessingState.completed && mounted) {
        setState(() => _playingVoiceover = false);
      }
    });
  }

  Future<void> _toggleSamplePlayback(String voiceId, String? sampleUrl) async {
    if (sampleUrl == null) return;
    if (_playingSampleId == voiceId) {
      await _player.stop();
      setState(() => _playingSampleId = null);
      return;
    }
    await _player.setUrl(sampleUrl);
    setState(() => _playingSampleId = voiceId);
    await _player.play();
    _player.playerStateStream.listen((s) {
      if (s.processingState == ProcessingState.completed && mounted) {
        setState(() => _playingSampleId = null);
      }
    });
  }

  Future<void> _regenerate(String voice) async {
    setState(() => _regenerating = true);
    try {
      final composition = await ref
          .read(projectRepositoryProvider)
          .regenerateVoice(widget.projectId, voice: voice);
      ref.read(compositionControllerProvider(widget.projectId).notifier).replaceComposition(composition);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Voiceover regenerated')));
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.isInsufficientTokens ? 'Not enough tokens to regenerate voice' : e.message),
        ));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Regenerate failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _regenerating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final compositionAsync = ref.watch(compositionControllerProvider(widget.projectId));
    final controller = ref.read(compositionControllerProvider(widget.projectId).notifier);

    return compositionAsync.when(
      data: (composition) {
        final voicesAsync = ref.watch(voicesProviderForLanguage(composition.language));
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (composition.voiceoverUrl != null)
              Card(
                child: ListTile(
                  leading: Icon(_playingVoiceover ? Icons.stop_circle : Icons.play_circle_outline),
                  title: const Text('Current voiceover'),
                  subtitle: const Text('Tap to preview'),
                  onTap: () => _toggleVoiceoverPlayback(composition.voiceoverUrl!),
                ),
              ),
            const SizedBox(height: 16),
            Text('Voice', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            voicesAsync.when(
              data: (voices) => Column(
                children: voices
                    .map(
                      (v) => RadioListTile<String>(
                        value: v.id,
                        groupValue: composition.voice,
                        title: Text(v.label),
                        secondary: IconButton(
                          icon: Icon(_playingSampleId == v.id ? Icons.stop_circle : Icons.play_circle_outline),
                          onPressed: () => _toggleSamplePlayback(v.id, v.sampleUrl),
                        ),
                        onChanged: (value) {
                          if (value != null) controller.updateVoice(value);
                        },
                      ),
                    )
                    .toList(),
              ),
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, __) => const Text('Could not load voices'),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _regenerating ? null : () => _regenerate(composition.voice),
              icon: _regenerating
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.record_voice_over_outlined),
              label: const Text('Regenerate voiceover'),
            ),
          ],
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('$error')),
    );
  }
}

final voicesProviderForLanguage = FutureProvider.autoDispose.family((ref, String language) async {
  return ref.watch(templateRepositoryProvider).listVoices(language: language);
});
