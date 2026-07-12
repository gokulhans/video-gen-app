import 'package:flutter/material.dart';

abstract final class AppRadii {
  static const small = 8.0;
  static const control = 12.0;
  static const largeControl = 14.0;
  static const card = 16.0;
  static const media = 20.0;
  static const pill = 999.0;

  static const cardBorder = BorderRadius.all(Radius.circular(card));
  static const controlBorder = BorderRadius.all(Radius.circular(control));
  static const mediaBorder = BorderRadius.all(Radius.circular(media));
}
