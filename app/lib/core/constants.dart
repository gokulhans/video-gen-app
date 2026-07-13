import 'package:flutter/foundation.dart';

/// Global app constants.
///
/// Override [apiBaseUrl] at build time with:
///   flutter run --dart-define=API_BASE_URL=https://api.example.com/api/v1
///
/// Firebase is skipped in debug builds by default. Force it on with:
///   flutter run --dart-define=ENABLE_FIREBASE=true
class AppConstants {
  AppConstants._();

  /// Base URL for the Cloudflare Workers API. Includes the `/api/v1` prefix.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: kDebugMode
        ? 'http://192.168.20.5:8787/api/v1'
        : 'https://api.gokulhansv.workers.dev/api/v1',
  );

  /// better-auth base path (separate from /api/v1, per CONTRACTS.md).
  static const String authBaseUrl = String.fromEnvironment(
    'AUTH_BASE_URL',
    defaultValue: kDebugMode
        ? 'http://192.168.20.5:8787/api/auth'
        : 'https://api.gokulhansv.workers.dev/api/auth',
  );

  static const String secureStorageTokenKey = 'auth_bearer_token';
  static const String secureStorageUserIdKey = 'auth_user_id';
  static const String secureStorageUserEmailKey = 'auth_user_email';

  /// Google OAuth web client id (used by google_sign_in for server-side token exchange).
  static const String googleServerClientId = String.fromEnvironment(
    'GOOGLE_SERVER_CLIENT_ID',
    defaultValue: '',
  );

  /// When false, Firebase/FCM init is skipped (faster local dev without
  /// google-services.json). Off by default in debug; on in release/profile.
  /// Override: `--dart-define=ENABLE_FIREBASE=true|false`
  static const bool enableFirebase = bool.fromEnvironment(
    'ENABLE_FIREBASE',
    defaultValue: !kDebugMode,
  );

  static const Duration autosaveDebounce = Duration(seconds: 2);
  static const Duration generationPollInterval = Duration(seconds: 3);
  static const Duration renderPollInterval = Duration(seconds: 3);
}
