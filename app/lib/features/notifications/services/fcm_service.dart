import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/repositories/notification_repository.dart';

/// Handles Firebase Cloud Messaging setup: requesting permission,
/// registering the device token with `POST /devices`, and wiring
/// foreground/background/tap handlers that navigate to the relevant
/// project when a notification is tapped.
///
/// Call [FcmService.initialize] once, after `Firebase.initializeApp()` in
/// main.dart, passing a callback that navigates to a project id.
class FcmService {
  FcmService(this._ref);

  final Ref _ref;
  final FirebaseMessaging _messaging = FirebaseMessaging.instance;

  Future<void> initialize({required void Function(String projectId) onNotificationTap}) async {
    if (Firebase.apps.isEmpty) {
      // main.dart is responsible for calling Firebase.initializeApp() with
      // platform options (google-services.json / GoogleService-Info.plist).
      // Guard here so this service degrades gracefully in dev without
      // Firebase configured yet.
      return;
    }

    final settings = await _messaging.requestPermission(alert: true, badge: true, sound: true);
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      return;
    }

    final token = await _messaging.getToken();
    if (token != null) {
      await _registerToken(token);
    }
    _messaging.onTokenRefresh.listen(_registerToken);

    // Foreground messages: FCM does not show a system notification while
    // the app is foregrounded, so this is where you'd show an in-app
    // banner/snackbar. Kept minimal here — see TODO below.
    FirebaseMessaging.onMessage.listen((message) {
      // TODO: surface an in-app banner using message.notification?.title/body.
    });

    // App opened from a background (not terminated) notification tap.
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      final projectId = message.data['projectId'] as String?;
      if (projectId != null) onNotificationTap(projectId);
    });

    // App launched from a terminated state via notification tap.
    final initialMessage = await _messaging.getInitialMessage();
    final projectId = initialMessage?.data['projectId'] as String?;
    if (projectId != null) onNotificationTap(projectId);
  }

  Future<void> _registerToken(String token) async {
    try {
      final platform = Platform.isIOS ? 'ios' : 'android';
      await _ref.read(notificationRepositoryProvider).registerDevice(fcmToken: token, platform: platform);
    } catch (_) {
      // Best-effort; retried on next app start / token refresh.
    }
  }
}

final fcmServiceProvider = Provider<FcmService>((ref) => FcmService(ref));

/// Background message handler must be a top-level function per the
/// firebase_messaging plugin contract. Register it in main.dart with
/// `FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler)`
/// BEFORE runApp(), after Firebase.initializeApp().
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Keep this minimal: heavy work here should be avoided since the OS may
  // kill the isolate shortly after. Local state sync happens when the app
  // is opened via onMessageOpenedApp/getInitialMessage instead.
}
