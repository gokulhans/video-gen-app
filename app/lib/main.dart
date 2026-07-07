import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/notifications/services/fcm_service.dart';
import 'router.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Requires `google-services.json` (Android) / `GoogleService-Info.plist`
  // (iOS) to be added per README.md. Guarded so the app still runs (minus
  // push notifications) if Firebase hasn't been configured yet in dev.
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (e) {
    debugPrint('Firebase.initializeApp() failed (is google-services.json present?): $e');
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
    WidgetsBinding.instance.addPostFrameCallback((_) => _initFcm());
  }

  Future<void> _initFcm() async {
    final fcm = ref.read(fcmServiceProvider);
    await fcm.initialize(
      onNotificationTap: (projectId) {
        final context = rootNavigatorKey.currentContext;
        if (context != null) {
          context.push('/editor/$projectId');
        }
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
