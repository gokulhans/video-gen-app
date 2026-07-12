import 'package:flutter/material.dart';

abstract final class AppElevation {
  static const none = 0.0;
  static const low = 1.0;
  static const medium = 4.0;

  static List<BoxShadow> soft(Color color) => [
    BoxShadow(color: color, blurRadius: 24, offset: const Offset(0, 10)),
  ];
}
