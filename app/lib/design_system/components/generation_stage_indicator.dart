import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../tokens/app_motion.dart';
import '../tokens/app_spacing.dart';

class GenerationStageIndicator extends StatelessWidget {
  const GenerationStageIndicator({
    super.key,
    required this.labels,
    required this.currentIndex,
  });

  final List<String> labels;
  final int currentIndex;

  @override
  Widget build(BuildContext context) {
    final tokens = context.appTokens;
    final reduceMotion = AppMotion.reduceMotion(context);
    return Semantics(
      label:
          'Generation stage ${currentIndex + 1} of ${labels.length}: ${labels[currentIndex.clamp(0, labels.length - 1)]}',
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 520;
          if (compact) {
            return Wrap(
              spacing: AppSpacing.xs,
              runSpacing: AppSpacing.xs,
              alignment: WrapAlignment.center,
              children: [
                for (var index = 0; index < labels.length; index++)
                  _StagePill(
                    label: labels[index],
                    state: _state(index),
                    animate: !reduceMotion,
                  ),
              ],
            );
          }
          return Row(
            children: [
              for (var index = 0; index < labels.length; index++) ...[
                Expanded(
                  child: _StagePill(
                    label: labels[index],
                    state: _state(index),
                    animate: !reduceMotion,
                  ),
                ),
                if (index < labels.length - 1)
                  SizedBox(
                    width: AppSpacing.lg,
                    child: Divider(
                      color: index < currentIndex
                          ? tokens.generationEnd
                          : tokens.immersiveTrack,
                      thickness: 2,
                    ),
                  ),
              ],
            ],
          );
        },
      ),
    );
  }

  _StageState _state(int index) => index < currentIndex
      ? _StageState.complete
      : index == currentIndex
      ? _StageState.current
      : _StageState.future;
}

enum _StageState { complete, current, future }

class _StagePill extends StatelessWidget {
  const _StagePill({
    required this.label,
    required this.state,
    required this.animate,
  });
  final String label;
  final _StageState state;
  final bool animate;

  @override
  Widget build(BuildContext context) {
    final tokens = context.appTokens;
    final active = state != _StageState.future;
    return AnimatedContainer(
      duration: animate ? AppMotion.standard : Duration.zero,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: active
            ? tokens.generationStart.withValues(alpha: .18)
            : tokens.immersiveTrack.withValues(alpha: .58),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: state == _StageState.current
              ? tokens.generationEnd
              : Colors.transparent,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            state == _StageState.complete
                ? Icons.check_rounded
                : state == _StageState.current
                ? Icons.auto_awesome_rounded
                : Icons.circle_outlined,
            size: 15,
            color: active ? tokens.immersiveForeground : tokens.immersiveMuted,
          ),
          const SizedBox(width: AppSpacing.xxs),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: active
                    ? tokens.immersiveForeground
                    : tokens.immersiveMuted,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
