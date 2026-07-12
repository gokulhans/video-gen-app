import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';

class AppTopBar extends StatelessWidget implements PreferredSizeWidget {
  const AppTopBar({
    super.key,
    required this.title,
    this.actions = const [],
    this.onBack,
    this.showDivider = false,
  });

  final Widget title;
  final List<Widget> actions;
  final VoidCallback? onBack;
  final bool showDivider;

  @override
  Size get preferredSize => const Size.fromHeight(64);

  @override
  Widget build(BuildContext context) {
    final border = Theme.of(context).colorScheme.outlineVariant;
    return AppBar(
      toolbarHeight: preferredSize.height,
      leading: onBack == null
          ? null
          : IconButton(
              tooltip: 'Back',
              onPressed: onBack,
              icon: const Icon(Icons.arrow_back_rounded),
            ),
      titleSpacing: onBack == null ? AppSpacing.md : 0,
      title: title,
      actions: [
        ...actions,
        const SizedBox(width: AppSpacing.xs),
      ],
      shape: showDivider ? Border(bottom: BorderSide(color: border)) : null,
    );
  }
}
