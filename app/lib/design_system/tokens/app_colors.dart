import 'package:flutter/material.dart';

/// Brand and semantic color primitives. Feature code should consume these
/// through [ColorScheme] or [AppThemeTokens], not hard-coded colors.
abstract final class AppColors {
  static const brand = Color(0xFF6C4CE0);
  static const accentViolet = Color(0xFF7957FF);
  static const generationStart = Color(0xFF7B4DFF);
  static const generationEnd = Color(0xFF536BFA);

  static const lightBackground = Color(0xFFF7F6FB);
  static const lightSurface = Color(0xFFFFFFFF);
  static const lightSoftSurface = Color(0xFFF1EFF8);
  static const lightText = Color(0xFF0C1020);
  static const lightMuted = Color(0xFF666B7C);
  static const lightBorder = Color(0xFFE7E5EE);

  static const darkBackground = Color(0xFF080A12);
  static const darkSurface = Color(0xFF12141D);
  static const darkRaisedSurface = Color(0xFF191B26);
  static const darkText = Color(0xFFF7F7FB);
  static const darkMuted = Color(0xFFA9ADBA);
  static const darkBorder = Color(0xFF292C38);

  static const lightSuccess = Color(0xFF147A4A);
  static const lightWarning = Color(0xFF9A5B00);
  static const lightError = Color(0xFFB42318);
  static const lightInfo = Color(0xFF2368B5);
  static const darkSuccess = Color(0xFF63D69B);
  static const darkWarning = Color(0xFFFFC46B);
  static const darkError = Color(0xFFFF8F88);
  static const darkInfo = Color(0xFF82B8F4);
  static const immersiveBackground = Color(0xFF0D1224);
  static const immersiveForeground = Color(0xFFF7F7FB);
  static const immersiveMuted = Color(0xFFB8BDCF);
  static const immersiveError = Color(0xFFFFB4AB);
  static const immersiveTrack = Color(0xFF30364D);
}
