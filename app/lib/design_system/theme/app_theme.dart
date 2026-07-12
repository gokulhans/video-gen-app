import 'package:flutter/material.dart';

import '../tokens/app_colors.dart';
import '../tokens/app_elevation.dart';
import '../tokens/app_radii.dart';
import '../tokens/app_spacing.dart';
import '../tokens/app_typography.dart';

@immutable
class AppThemeTokens extends ThemeExtension<AppThemeTokens> {
  const AppThemeTokens({
    required this.generationStart,
    required this.generationEnd,
    required this.success,
    required this.warning,
    required this.info,
    required this.softSurface,
    required this.raisedSurface,
    required this.mediaOverlay,
    required this.glow,
    required this.shadow,
    required this.immersiveBackground,
    required this.immersiveForeground,
    required this.immersiveMuted,
    required this.immersiveError,
    required this.immersiveTrack,
  });

  final Color generationStart;
  final Color generationEnd;
  final Color success;
  final Color warning;
  final Color info;
  final Color softSurface;
  final Color raisedSurface;
  final Color mediaOverlay;
  final Color glow;
  final Color shadow;
  final Color immersiveBackground;
  final Color immersiveForeground;
  final Color immersiveMuted;
  final Color immersiveError;
  final Color immersiveTrack;

  LinearGradient get generationGradient => LinearGradient(
    colors: [generationStart, generationEnd],
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
  );

  @override
  AppThemeTokens copyWith({
    Color? generationStart,
    Color? generationEnd,
    Color? success,
    Color? warning,
    Color? info,
    Color? softSurface,
    Color? raisedSurface,
    Color? mediaOverlay,
    Color? glow,
    Color? shadow,
    Color? immersiveBackground,
    Color? immersiveForeground,
    Color? immersiveMuted,
    Color? immersiveError,
    Color? immersiveTrack,
  }) => AppThemeTokens(
    generationStart: generationStart ?? this.generationStart,
    generationEnd: generationEnd ?? this.generationEnd,
    success: success ?? this.success,
    warning: warning ?? this.warning,
    info: info ?? this.info,
    softSurface: softSurface ?? this.softSurface,
    raisedSurface: raisedSurface ?? this.raisedSurface,
    mediaOverlay: mediaOverlay ?? this.mediaOverlay,
    glow: glow ?? this.glow,
    shadow: shadow ?? this.shadow,
    immersiveBackground: immersiveBackground ?? this.immersiveBackground,
    immersiveForeground: immersiveForeground ?? this.immersiveForeground,
    immersiveMuted: immersiveMuted ?? this.immersiveMuted,
    immersiveError: immersiveError ?? this.immersiveError,
    immersiveTrack: immersiveTrack ?? this.immersiveTrack,
  );

  @override
  AppThemeTokens lerp(covariant AppThemeTokens? other, double t) {
    if (other == null) return this;
    return AppThemeTokens(
      generationStart: Color.lerp(generationStart, other.generationStart, t)!,
      generationEnd: Color.lerp(generationEnd, other.generationEnd, t)!,
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      info: Color.lerp(info, other.info, t)!,
      softSurface: Color.lerp(softSurface, other.softSurface, t)!,
      raisedSurface: Color.lerp(raisedSurface, other.raisedSurface, t)!,
      mediaOverlay: Color.lerp(mediaOverlay, other.mediaOverlay, t)!,
      glow: Color.lerp(glow, other.glow, t)!,
      shadow: Color.lerp(shadow, other.shadow, t)!,
      immersiveBackground: Color.lerp(
        immersiveBackground,
        other.immersiveBackground,
        t,
      )!,
      immersiveForeground: Color.lerp(
        immersiveForeground,
        other.immersiveForeground,
        t,
      )!,
      immersiveMuted: Color.lerp(immersiveMuted, other.immersiveMuted, t)!,
      immersiveError: Color.lerp(immersiveError, other.immersiveError, t)!,
      immersiveTrack: Color.lerp(immersiveTrack, other.immersiveTrack, t)!,
    );
  }
}

extension AppThemeContext on BuildContext {
  AppThemeTokens get appTokens => Theme.of(this).extension<AppThemeTokens>()!;
}

abstract final class AppTheme {
  static ThemeData get light => _build(Brightness.light);
  static ThemeData get dark => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final background = isDark
        ? AppColors.darkBackground
        : AppColors.lightBackground;
    final surface = isDark ? AppColors.darkSurface : AppColors.lightSurface;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final muted = isDark ? AppColors.darkMuted : AppColors.lightMuted;
    final border = isDark ? AppColors.darkBorder : AppColors.lightBorder;
    final error = isDark ? AppColors.darkError : AppColors.lightError;

    final scheme =
        ColorScheme.fromSeed(
          seedColor: AppColors.brand,
          brightness: brightness,
          primary: AppColors.brand,
          surface: surface,
          error: error,
        ).copyWith(
          onPrimary: AppColors.lightSurface,
          onSurface: text,
          onSurfaceVariant: muted,
          outline: border,
          outlineVariant: border,
          surfaceContainerLowest: surface,
          surfaceContainerLow: surface,
          surfaceContainer: isDark
              ? AppColors.darkRaisedSurface
              : AppColors.lightSoftSurface,
          surfaceContainerHigh: isDark
              ? AppColors.darkRaisedSurface
              : AppColors.lightSoftSurface,
          surfaceContainerHighest: isDark
              ? AppColors.darkRaisedSurface
              : AppColors.lightSoftSurface,
        );

    final tokens = AppThemeTokens(
      generationStart: AppColors.generationStart,
      generationEnd: AppColors.generationEnd,
      success: isDark ? AppColors.darkSuccess : AppColors.lightSuccess,
      warning: isDark ? AppColors.darkWarning : AppColors.lightWarning,
      info: isDark ? AppColors.darkInfo : AppColors.lightInfo,
      softSurface: isDark
          ? AppColors.darkRaisedSurface
          : AppColors.lightSoftSurface,
      raisedSurface: isDark
          ? AppColors.darkRaisedSurface
          : AppColors.lightSurface,
      mediaOverlay: const Color(0x99000000),
      glow: AppColors.accentViolet.withValues(alpha: isDark ? 0.32 : 0.2),
      shadow: const Color(0xFF0C1020).withValues(alpha: isDark ? 0.3 : 0.07),
      immersiveBackground: AppColors.immersiveBackground,
      immersiveForeground: AppColors.immersiveForeground,
      immersiveMuted: AppColors.immersiveMuted,
      immersiveError: AppColors.immersiveError,
      immersiveTrack: AppColors.immersiveTrack,
    );

    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      canvasColor: background,
      fontFamily: null,
      textTheme: AppTypography.textTheme.apply(
        bodyColor: text,
        displayColor: text,
      ),
      extensions: [tokens],
      splashFactory: InkSparkle.splashFactory,
    );

    return base.copyWith(
      appBarTheme: AppBarTheme(
        backgroundColor: background,
        foregroundColor: text,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        elevation: AppElevation.none,
        scrolledUnderElevation: AppElevation.low,
        titleTextStyle: base.textTheme.titleLarge,
      ),
      cardTheme: CardThemeData(
        color: surface,
        surfaceTintColor: Colors.transparent,
        elevation: AppElevation.none,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadii.cardBorder,
          side: BorderSide(color: border),
        ),
      ),
      dividerTheme: DividerThemeData(color: border, thickness: 1),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: tokens.softSurface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        hintStyle: base.textTheme.bodyMedium?.copyWith(color: muted),
        border: const OutlineInputBorder(
          borderRadius: AppRadii.controlBorder,
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadii.controlBorder,
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: const OutlineInputBorder(
          borderRadius: AppRadii.controlBorder,
          borderSide: BorderSide(color: AppColors.brand, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppRadii.controlBorder,
          borderSide: BorderSide(color: error),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(0, AppSpacing.prominentTouchTarget),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(
              Radius.circular(AppRadii.largeControl),
            ),
          ),
          textStyle: base.textTheme.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, AppSpacing.standardTouchTarget),
          side: BorderSide(color: border),
          shape: const RoundedRectangleBorder(
            borderRadius: AppRadii.controlBorder,
          ),
          textStyle: base.textTheme.labelLarge,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          minimumSize: const Size.square(AppSpacing.minimumTouchTarget),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 72,
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: AppColors.brand.withValues(alpha: 0.12),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => base.textTheme.labelSmall?.copyWith(
            color: states.contains(WidgetState.selected)
                ? AppColors.brand
                : muted,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? AppColors.brand
                : muted,
          ),
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: surface,
        indicatorColor: AppColors.brand.withValues(alpha: 0.12),
        selectedIconTheme: const IconThemeData(color: AppColors.brand),
        unselectedIconTheme: IconThemeData(color: muted),
        selectedLabelTextStyle: base.textTheme.labelMedium?.copyWith(
          color: AppColors.brand,
        ),
        unselectedLabelTextStyle: base.textTheme.labelMedium?.copyWith(
          color: muted,
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: tokens.softSurface,
        selectedColor: AppColors.brand.withValues(alpha: 0.12),
        side: BorderSide(color: border),
        shape: const StadiumBorder(),
        labelStyle: base.textTheme.labelMedium,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.brand,
      ),
    );
  }
}
