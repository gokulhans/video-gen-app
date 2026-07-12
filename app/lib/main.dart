import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/constants.dart';
import 'firebase_options.dart';
import 'features/notifications/services/fcm_service.dart';
import 'features/notifications/providers/notification_providers.dart';
import 'router.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (AppConstants.enableFirebase) {
    // Requires `google-services.json` (Android) / `GoogleService-Info.plist`
    // (iOS). Set ENABLE_FIREBASE=false or use a debug build to skip in dev.
    try {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    } catch (e) {
      debugPrint(
        'Firebase.initializeApp() failed (is google-services.json present?): $e',
      );
    }
  } else {
    debugPrint('Firebase disabled (debug build or ENABLE_FIREBASE=false)');
  }

  runApp(const ProviderScope(child: AiVideoMakerApp()));
}

class AiVideoMakerApp extends ConsumerStatefulWidget {
  const AiVideoMakerApp({super.key});

  @override
  ConsumerState<AiVideoMakerApp> createState() => _AiVideoMakerAppState();
}

class _AiVideoMakerAppState extends ConsumerState<AiVideoMakerApp> {
  @override
  void initState() {
    super.initState();
    if (AppConstants.enableFirebase) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _initFcm());
    }
  }

  Future<void> _initFcm() async {
    final fcm = ref.read(fcmServiceProvider);
    await fcm.initialize(
      onNotificationTap: (deepLink) {
        final context = rootNavigatorKey.currentContext;
        if (context != null) {
          context.push(deepLink);
        }
      },
      onForeground: (message, deepLink) {
        ref.invalidate(notificationPageProvider);
        ref.invalidate(unreadNotificationCountProvider);
        final context = rootNavigatorKey.currentContext;
        if (context == null) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              message.notification?.body ?? 'You have a new update',
            ),
            action: deepLink == null
                ? null
                : SnackBarAction(
                    label: 'View',
                    onPressed: () => context.push(deepLink),
                  ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'AI Video Maker',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.system,
      routerConfig: router,
    );
  }
}
