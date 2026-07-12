import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../tokens/app_radii.dart';
import '../tokens/app_spacing.dart';

enum PrimaryActionStyle { standard, generation }

class PrimaryActionButton extends StatelessWidget {
  const PrimaryActionButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.isLoading = false,
    this.style = PrimaryActionStyle.standard,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool isLoading;
  final PrimaryActionStyle style;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !isLoading;
    final content = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (isLoading)
          const SizedBox.square(
            dimension: 19,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Colors.white,
            ),
          )
        else if (icon != null)
          Icon(icon, size: 20),
        if (isLoading || icon != null) const SizedBox(width: AppSpacing.xs),
        Flexible(child: Text(isLoading ? 'Please wait' : label)),
      ],
    );

    if (style == PrimaryActionStyle.standard) {
      return FilledButton(
        onPressed: enabled ? onPressed : null,
        child: content,
      );
    }

    final tokens = context.appTokens;
    return Semantics(
      button: true,
      enabled: enabled,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 140),
        opacity: enabled ? 1 : 0.48,
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: tokens.generationGradient,
            borderRadius: const BorderRadius.all(
              Radius.circular(AppRadii.largeControl),
            ),
            boxShadow: enabled
                ? [
                    BoxShadow(
                      color: tokens.glow,
                      blurRadius: 20,
                      offset: const Offset(0, 8),
                    ),
                  ]
                : null,
          ),
          child: Material(
            color: Colors.transparent,
            clipBehavior: Clip.antiAlias,
            borderRadius: const BorderRadius.all(
              Radius.circular(AppRadii.largeControl),
            ),
            child: InkWell(
              onTap: enabled ? onPressed : null,
              child: ConstrainedBox(
                constraints: const BoxConstraints(
                  minHeight: AppSpacing.prominentTouchTarget,
                ),
                child: DefaultTextStyle.merge(
                  style: Theme.of(
                    context,
                  ).textTheme.labelLarge?.copyWith(color: Colors.white),
                  child: IconTheme(
                    data: const IconThemeData(color: Colors.white),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.lg,
                      ),
                      child: content,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
