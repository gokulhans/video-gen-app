import 'package:ai_video_maker/core/models/account_settings.dart';
import 'package:ai_video_maker/core/models/brand.dart';
import 'package:ai_video_maker/features/brands/screens/brand_kits_screen.dart';
import 'package:ai_video_maker/features/settings/screens/settings_screen.dart';
import 'package:ai_video_maker/core/models/notification.dart';
import 'package:ai_video_maker/features/notifications/providers/notification_providers.dart';
import 'package:ai_video_maker/features/notifications/screens/notifications_screen.dart';
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
                  name: 'Northstar International Storytelling Brand System',
                  primaryColor: '#6750A4',
                  secondaryColor: '#00A896',
                ),
              ],
            ),
          ],
          child: MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(
                size: viewport,
                textScaler: const TextScaler.linear(1.5),
              ),
              child: const BrandKitsScreen(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Northstar International'), findsOneWidget);
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
            exportRequestsProvider.overrideWith((ref) async => const []),
            deletionRequestsProvider.overrideWith((ref) async => const []),
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

  testWidgets('notifications remain usable compact and wide at 1.5x text', (
    tester,
  ) async {
    for (final viewport in const [Size(375, 812), Size(1200, 900)]) {
      await size(tester, viewport);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            notificationPageProvider.overrideWith(
              (ref) async => NotificationPage(
                items: [
                  AppNotification(
                    id: 'notification_1',
                    type: NotificationType.generationComplete,
                    title:
                        'Your unusually detailed generated campaign video is ready',
                    message:
                        'A longer notification body verifies that the responsive card remains readable without clipping actions or dates.',
                    createdAt: DateTime(2026, 7, 12),
                  ),
                ],
              ),
            ),
          ],
          child: MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(
                size: viewport,
                textScaler: const TextScaler.linear(1.5),
              ),
              child: const NotificationsScreen(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('unusually detailed'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });
}
