// Basic smoke test. The full app (AiVideoMakerApp) initializes Firebase and
// makes network calls on startup, so it isn't pumped directly here to keep
// this test hermetic; add integration tests with mocked repositories for
// deeper coverage.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ai_video_maker/theme.dart';

void main() {
  testWidgets('AppTheme builds light and dark ThemeData', (
    WidgetTester tester,
  ) async {
    expect(AppTheme.light.useMaterial3, isTrue);
    expect(AppTheme.dark.useMaterial3, isTrue);
    expect(AppTheme.light.brightness, Brightness.light);
    expect(AppTheme.dark.brightness, Brightness.dark);
  });

  testWidgets('MaterialApp with AppTheme.light renders', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: const Scaffold(body: Text('AI Video Maker')),
      ),
    );
    expect(find.text('AI Video Maker'), findsOneWidget);
  });
}
