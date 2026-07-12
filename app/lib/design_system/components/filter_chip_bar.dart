import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';

class AppFilterOption<T> {
  const AppFilterOption({required this.value, required this.label, this.icon});

  final T value;
  final String label;
  final IconData? icon;
}

class FilterChipBar<T> extends StatelessWidget {
  const FilterChipBar({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  final List<AppFilterOption<T>> options;
  final T selected;
  final ValueChanged<T> onSelected;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
      child: Row(
        children: [
          for (var index = 0; index < options.length; index++) ...[
            FilterChip(
              selected: options[index].value == selected,
              onSelected: (_) => onSelected(options[index].value),
              avatar: options[index].icon == null
                  ? null
                  : Icon(options[index].icon, size: 16),
              label: Text(options[index].label),
              showCheckmark: false,
            ),
            if (index != options.length - 1)
              const SizedBox(width: AppSpacing.xs),
          ],
        ],
      ),
    );
  }
}
