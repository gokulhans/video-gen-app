import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../tokens/app_colors.dart';
import '../tokens/app_radii.dart';
import '../tokens/app_spacing.dart';

enum MediaPreviewKind { presenter, video, progress, voice }

/// Asset-safe preview geometry used to communicate future media content
/// without inventing records or embedding third-party imagery.
class MediaPreviewTile extends StatelessWidget {
  const MediaPreviewTile({
    super.key,
    required this.kind,
    this.aspectRatio = 9 / 16,
    this.selected = false,
    this.progress,
    this.height,
  });

  final MediaPreviewKind kind;
  final double aspectRatio;
  final bool selected;
  final double? progress;
  final double? height;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tokens = context.appTokens;
    final canvas = Semantics(
      label: switch (kind) {
        MediaPreviewKind.presenter => 'Presenter preview placeholder',
        MediaPreviewKind.video => 'Video preview placeholder',
        MediaPreviewKind.progress => 'Video generation preview placeholder',
        MediaPreviewKind.voice => 'Voice waveform preview placeholder',
      },
      image: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: tokens.softSurface,
          borderRadius: AppRadii.mediaBorder,
          border: Border.all(
            color: selected ? tokens.generationStart : scheme.outlineVariant,
            width: selected ? 1.5 : 1,
          ),
          boxShadow: selected
              ? [
                  BoxShadow(
                    color: tokens.glow,
                    blurRadius: 18,
                    offset: const Offset(0, 7),
                  ),
                ]
              : null,
        ),
        child: ClipRRect(
          borderRadius: AppRadii.mediaBorder,
          child: Stack(
            fit: StackFit.expand,
            children: [
              CustomPaint(
                painter: _MediaPreviewPainter(
                  kind: kind,
                  foreground: scheme.onSurfaceVariant,
                  background: tokens.softSurface,
                  accent: tokens.generationStart,
                  accentEnd: tokens.generationEnd,
                ),
              ),
              if (kind == MediaPreviewKind.video)
                Center(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: scheme.surface.withValues(alpha: 0.9),
                      shape: BoxShape.circle,
                    ),
                    child: const Padding(
                      padding: EdgeInsets.all(AppSpacing.sm),
                      child: Icon(
                        Icons.play_arrow_rounded,
                        color: AppColors.accentViolet,
                        size: 24,
                      ),
                    ),
                  ),
                ),
              if (kind == MediaPreviewKind.progress)
                Align(
                  alignment: Alignment.bottomCenter,
                  child: LinearProgressIndicator(
                    value: progress ?? 0.64,
                    minHeight: 4,
                    color: tokens.generationEnd,
                    backgroundColor: scheme.surface.withValues(alpha: 0.5),
                  ),
                ),
            ],
          ),
        ),
      ),
    );

    if (height != null) {
      return SizedBox(height: height, child: canvas);
    }
    return AspectRatio(aspectRatio: aspectRatio, child: canvas);
  }
}

class _MediaPreviewPainter extends CustomPainter {
  const _MediaPreviewPainter({
    required this.kind,
    required this.foreground,
    required this.background,
    required this.accent,
    required this.accentEnd,
  });

  final MediaPreviewKind kind;
  final Color foreground;
  final Color background;
  final Color accent;
  final Color accentEnd;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final backgroundPaint = Paint()
      ..shader = LinearGradient(
        colors: [background, accent.withValues(alpha: 0.13)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ).createShader(rect);
    canvas.drawRect(rect, backgroundPaint);

    if (kind == MediaPreviewKind.voice) {
      _paintWaveform(canvas, size);
      return;
    }

    final glow = Paint()
      ..shader =
          RadialGradient(
            colors: [accentEnd.withValues(alpha: 0.3), Colors.transparent],
          ).createShader(
            Rect.fromCircle(
              center: Offset(size.width * 0.72, size.height * 0.2),
              radius: size.longestSide * 0.65,
            ),
          );
    canvas.drawRect(rect, glow);

    final silhouette = Paint()..color = foreground.withValues(alpha: 0.18);
    final headRadius = size.shortestSide * 0.15;
    final head = Offset(size.width * 0.5, size.height * 0.35);
    canvas.drawCircle(head, headRadius, silhouette);
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(
          center: Offset(size.width * 0.5, size.height * 0.79),
          width: size.width * 0.72,
          height: size.height * 0.62,
        ),
        Radius.circular(size.shortestSide * 0.28),
      ),
      silhouette,
    );

    final linePaint = Paint()
      ..color = accent.withValues(alpha: 0.34)
      ..strokeWidth = 1.5;
    canvas.drawLine(
      Offset(size.width * 0.12, size.height * 0.12),
      Offset(size.width * 0.38, size.height * 0.12),
      linePaint,
    );
    canvas.drawCircle(
      Offset(size.width * 0.82, size.height * 0.12),
      size.shortestSide * 0.025,
      linePaint,
    );
  }

  void _paintWaveform(Canvas canvas, Size size) {
    final paint = Paint()
      ..shader = LinearGradient(
        colors: [accent, accentEnd],
      ).createShader(Offset.zero & size)
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 3;
    const heights = [0.22, 0.42, 0.68, 0.38, 0.8, 0.5, 0.3, 0.62, 0.44];
    for (var index = 0; index < heights.length; index++) {
      final x = size.width * (index + 1) / (heights.length + 1);
      final half = size.height * heights[index] * 0.25;
      canvas.drawLine(
        Offset(x, size.height / 2 - half),
        Offset(x, size.height / 2 + half),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _MediaPreviewPainter oldDelegate) =>
      oldDelegate.kind != kind ||
      oldDelegate.foreground != foreground ||
      oldDelegate.background != background ||
      oldDelegate.accent != accent ||
      oldDelegate.accentEnd != accentEnd;
}
