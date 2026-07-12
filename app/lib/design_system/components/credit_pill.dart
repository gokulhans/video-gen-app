import 'package:flutter/material.dart';

import '../tokens/app_colors.dart';
import '../tokens/app_spacing.dart';

class CreditPill extends StatelessWidget {
  const CreditPill({
    super.key,
    this.balance,
    this.isLoading = false,
    this.hasError = false,
    this.onTap,
  });

  final int? balance;
  final bool isLoading;
  final bool hasError;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      button: onTap != null,
      label: hasError
          ? 'Credit balance unavailable'
          : balance == null
          ? 'Loading credit balance'
          : '$balance credits',
      child: Material(
        color: scheme.surface,
        shape: StadiumBorder(side: BorderSide(color: scheme.outlineVariant)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: AppSpacing.minimumTouchTarget,
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.sm,
                vertical: AppSpacing.xs,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.auto_awesome_rounded,
                    size: 17,
                    color: AppColors.accentViolet,
                  ),
                  const SizedBox(width: AppSpacing.xs),
                  if (isLoading)
                    const SizedBox.square(
                      dimension: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  else
                    Text(
                      hasError ? '--' : '${balance ?? 0}',
                      style: Theme.of(context).textTheme.labelMedium,
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
