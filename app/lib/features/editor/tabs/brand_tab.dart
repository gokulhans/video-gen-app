import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/composition.dart';
import '../providers/editor_providers.dart';

/// Brand tab: brand selector, logo corner, watermark toggle (paid feature —
/// disabling the watermark is gated server-side, so we surface the intent
/// and let the API reject it with INSUFFICIENT_PLAN / similar if needed).
class BrandTab extends ConsumerWidget {
  const BrandTab({super.key, required this.projectId});

  final String projectId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final compositionAsync = ref.watch(
      compositionControllerProvider(projectId),
    );
    final controller = ref.read(
      compositionControllerProvider(projectId).notifier,
    );
    final brandsAsync = ref.watch(brandsProvider);

    return compositionAsync.when(
      data: (composition) {
        final brand = composition.brand;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Brand', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            brandsAsync.when(
              data: (brands) {
                if (brands.isEmpty) {
                  return const Text(
                    'No saved brands yet. Create one from Settings.',
                  );
                }
                return DropdownButtonFormField<String>(
                  initialValue: brands
                      .firstWhere(
                        (b) =>
                            b.logoUrl == brand.logoUrl && brand.logoUrl != null,
                        orElse: () => brands.first,
                      )
                      .id,
                  items: brands
                      .map(
                        (b) =>
                            DropdownMenuItem(value: b.id, child: Text(b.name)),
                      )
                      .toList(),
                  onChanged: (id) {
                    final selected = brands.firstWhere((b) => b.id == id);
                    controller.updateBrand(selected.toBrandConfig());
                  },
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, _) => const Text('Could not load brands'),
            ),
            const SizedBox(height: 24),
            Text(
              'Logo position',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: LogoPosition.values
                  .map(
                    (position) => ChoiceChip(
                      label: Text(_positionLabel(position)),
                      selected: brand.logoPosition == position,
                      onSelected: (_) => controller.updateBrand(
                        brand.copyWith(logoPosition: position),
                      ),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 24),
            SwitchListTile(
              title: const Text('Watermark'),
              subtitle: const Text(
                'Removing the watermark requires a paid plan',
              ),
              value: brand.watermark,
              onChanged: (value) =>
                  controller.updateBrand(brand.copyWith(watermark: value)),
            ),
          ],
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text('$error')),
    );
  }

  String _positionLabel(LogoPosition position) => switch (position) {
    LogoPosition.topLeft => 'Top left',
    LogoPosition.topRight => 'Top right',
    LogoPosition.bottomLeft => 'Bottom left',
    LogoPosition.bottomRight => 'Bottom right',
    LogoPosition.none => 'None',
  };
}
