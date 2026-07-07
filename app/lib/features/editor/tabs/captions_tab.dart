import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/composition.dart';
import '../providers/editor_providers.dart';

/// Captions tab: preset picker, position, and colors.
class CaptionsTab extends ConsumerWidget {
  const CaptionsTab({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final compositionAsync = ref.watch(compositionControllerProvider(projectId));
    final controller = ref.read(compositionControllerProvider(projectId).notifier);

    return compositionAsync.when(
      data: (composition) {
        final captions = composition.captions;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SwitchListTile(
              title: const Text('Show captions'),
              value: captions.enabled,
              onChanged: (value) => controller.updateCaptions(captions.copyWith(enabled: value)),
            ),
            const SizedBox(height: 8),
            Text('Preset', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: CaptionPreset.values
                  .map(
                    (preset) => ChoiceChip(
                      label: Text(preset.label),
                      selected: captions.preset == preset,
                      onSelected: (_) => controller.updateCaptions(captions.copyWith(preset: preset)),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 20),
            Text('Position', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            SegmentedButton<CaptionPosition>(
              segments: const [
                ButtonSegment(value: CaptionPosition.top, label: Text('Top')),
                ButtonSegment(value: CaptionPosition.center, label: Text('Center')),
                ButtonSegment(value: CaptionPosition.bottom, label: Text('Bottom')),
              ],
              selected: {captions.position},
              onSelectionChanged: (selection) =>
                  controller.updateCaptions(captions.copyWith(position: selection.first)),
            ),
            const SizedBox(height: 20),
            Text('Text color', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            _ColorRow(
              selected: captions.primaryColor,
              onSelected: (color) => controller.updateCaptions(captions.copyWith(primaryColor: color)),
            ),
            const SizedBox(height: 20),
            Text('Highlight color', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            _ColorRow(
              selected: captions.highlightColor,
              onSelected: (color) => controller.updateCaptions(captions.copyWith(highlightColor: color)),
            ),
            const SizedBox(height: 20),
            Text('Font size: ${captions.fontSize.round()}', style: Theme.of(context).textTheme.titleMedium),
            Slider(
              value: captions.fontSize,
              min: 24,
              max: 72,
              divisions: 24,
              label: captions.fontSize.round().toString(),
              onChanged: (value) => controller.updateCaptions(captions.copyWith(fontSize: value)),
            ),
          ],
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('$error')),
    );
  }
}

const _swatches = [
  '#FFFFFF',
  '#000000',
  '#FFD700',
  '#FF3B30',
  '#34C759',
  '#0A84FF',
  '#FF2D55',
];

class _ColorRow extends StatelessWidget {
  const _ColorRow({required this.selected, required this.onSelected});

  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 12,
      children: _swatches.map((hex) {
        final color = Color(int.parse(hex.substring(1), radix: 16) + 0xFF000000);
        final isSelected = hex.toUpperCase() == selected.toUpperCase();
        return GestureDetector(
          onTap: () => onSelected(hex),
          child: Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(
                color: isSelected ? Theme.of(context).colorScheme.primary : Colors.grey.shade400,
                width: isSelected ? 3 : 1,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}
