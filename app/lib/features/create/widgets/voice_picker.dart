import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';

import '../../../core/models/template.dart';

/// A horizontally scrollable list of voice options with inline sample
/// playback via just_audio.
class VoicePicker extends StatefulWidget {
  const VoicePicker({
    super.key,
    required this.voices,
    required this.selectedId,
    required this.onSelected,
  });

  final List<VoiceOption> voices;
  final String selectedId;
  final ValueChanged<String> onSelected;

  @override
  State<VoicePicker> createState() => _VoicePickerState();
}

class _VoicePickerState extends State<VoicePicker> {
  final AudioPlayer _player = AudioPlayer();
  String? _playingId;

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _togglePlay(VoiceOption voice) async {
    if (voice.sampleUrl == null) return;
    if (_playingId == voice.id) {
      await _player.stop();
      setState(() => _playingId = null);
      return;
    }
    try {
      await _player.setUrl(voice.sampleUrl!);
      setState(() => _playingId = voice.id);
      await _player.play();
      _player.playerStateStream.listen((s) {
        if (s.processingState == ProcessingState.completed && mounted) {
          setState(() => _playingId = null);
        }
      });
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not play voice sample')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.voices.isEmpty) {
      return const Text('No voices available for this language yet.');
    }
    return SizedBox(
      height: 96,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: widget.voices.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final voice = widget.voices[index];
          final selected = voice.id == widget.selectedId;
          final playing = _playingId == voice.id;
          return GestureDetector(
            onTap: () => widget.onSelected(voice.id),
            child: Container(
              width: 104,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: selected
                    ? Theme.of(context).colorScheme.primaryContainer
                    : Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(14),
                border: selected
                    ? Border.all(
                        color: Theme.of(context).colorScheme.primary,
                        width: 2,
                      )
                    : null,
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    onPressed: () => _togglePlay(voice),
                    icon: Icon(
                      playing ? Icons.stop_circle : Icons.play_circle_outline,
                    ),
                  ),
                  Text(
                    voice.label,
                    style: Theme.of(context).textTheme.bodySmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
