import 'package:ai_video_maker/core/models/account_settings.dart';
import 'package:ai_video_maker/core/models/brand.dart';
import 'package:ai_video_maker/features/brands/screens/brand_kits_screen.dart';
import 'package:ai_video_maker/features/settings/screens/settings_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<void> size(WidgetTester tester, Size value) async {
    tester.view.physicalSize = value;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
  }

  testWidgets('brand kits remain usable on compact and wide layouts', (
    tester,
  ) async {
    for (final viewport in const [Size(375, 812), Size(1200, 900)]) {
      await size(tester, viewport);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            brandKitsProvider.overrideWith(
              (ref) async => const [
                Brand(
                  id: 'brand_1',
                  name: 'Northstar',
                  primaryColor: '#6750A4',
                  secondaryColor: '#00A896',
                ),
              ],
            ),
          ],
          child: const MaterialApp(home: BrandKitsScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Northstar'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('settings split responsibly without hiding lifecycle warnings', (
    tester,
  ) async {
    for (final viewport in const [Size(375, 812), Size(1200, 900)]) {
      await size(tester, viewport);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            settingsPreferencesProvider.overrideWith(
              (ref) async => const NotificationPreferences(
                pushEnabled: true,
                emailEnabled: false,
                generationUpdates: true,
                renderUpdates: true,
                productUpdates: false,
              ),
            ),
            consentSummaryProvider.overrideWith(
              (ref) async => {'characterConsentRecords': 2},
            ),
          ],
          child: const MaterialApp(home: SettingsScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Privacy & account'), findsOneWidget);
      expect(find.text('Request account deletion'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });
}
