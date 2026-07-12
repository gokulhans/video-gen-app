import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../tokens/app_radii.dart';

class MediaPoster extends StatelessWidget {
  const MediaPoster({
    super.key,
    this.imageUrl,
    this.aspectRatio = 9 / 16,
    this.overlay,
    this.semanticLabel,
    this.borderRadius = AppRadii.mediaBorder,
  });

  final String? imageUrl;
  final double aspectRatio;
  final Widget? overlay;
  final String? semanticLabel;
  final BorderRadius borderRadius;

  @override
  Widget build(BuildContext context) {
    final poster = imageUrl == null || imageUrl!.isEmpty
        ? const _PosterPlaceholder()
        : Image.network(
            imageUrl!,
            fit: BoxFit.cover,
            frameBuilder: (context, child, frame, _) => frame == null
                ? const _PosterPlaceholder(isLoading: true)
                : child,
            errorBuilder: (context, error, stackTrace) =>
                const _PosterPlaceholder(),
          );

    return Semantics(
      image: true,
      label: semanticLabel ?? 'Video preview',
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: ClipRRect(
          borderRadius: borderRadius,
          child: Stack(
            fit: StackFit.expand,
            children: [
              poster,
              if (overlay != null) ...[
                ColoredBox(color: context.appTokens.mediaOverlay),
                overlay!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _PosterPlaceholder extends StatelessWidget {
  const _PosterPlaceholder({this.isLoading = false});

  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: context.appTokens.softSurface,
      child: Center(
        child: isLoading
            ? const SizedBox.square(
                dimension: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Icon(
                Icons.movie_creation_outlined,
                size: 36,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
      ),
    );
  }
}
