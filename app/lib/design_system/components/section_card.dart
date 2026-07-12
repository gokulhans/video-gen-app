import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../tokens/app_radii.dart';
import '../tokens/app_spacing.dart';

class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.md),
    this.onTap,
    this.raised = false,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final bool raised;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tokens = context.appTokens;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: raised ? tokens.raisedSurface : scheme.surface,
        borderRadius: AppRadii.cardBorder,
        border: Border.all(color: scheme.outlineVariant),
        boxShadow: raised
            ? [
                BoxShadow(
                  color: tokens.shadow,
                  blurRadius: 24,
                  offset: const Offset(0, 10),
                ),
              ]
            : null,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: AppRadii.cardBorder,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}
