import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'api_client.dart';
import 'constants.dart';
import 'models/user.dart';

/// Handles better-auth email+password and Google sign-in, and persists the
/// resulting bearer token + minimal session info in secure storage.
///
/// better-auth's REST surface (`/api/auth/*`) is separate from the
/// `/api/v1` app API (see CONTRACTS.md), so this repository talks to
/// [AppConstants.authBaseUrl] directly via its own [Dio] instance rather
/// than the shared [ApiClient].
class AuthRepository {
  AuthRepository(this._storage)
      : _authDio = Dio(
          BaseOptions(
            baseUrl: AppConstants.authBaseUrl,
            contentType: 'application/json',
            connectTimeout: const Duration(seconds: 20),
          ),
        );

  final FlutterSecureStorage _storage;
  final Dio _authDio;

  final GoogleSignIn _googleSignIn = GoogleSignIn(
    serverClientId: AppConstants.googleServerClientId.isEmpty
        ? null
        : AppConstants.googleServerClientId,
    scopes: const ['email', 'profile'],
  );

  Future<String?> currentToken() => _storage.read(key: AppConstants.secureStorageTokenKey);

  Future<bool> isSignedIn() async {
    final token = await currentToken();
    return token != null && token.isNotEmpty;
  }

  Future<AppUser> signUpWithEmail({
    required String name,
    required String email,
    required String password,
  }) async {
    try {
      final response = await _authDio.post(
        '/sign-up/email',
        data: {'name': name, 'email': email, 'password': password},
      );
      return _persistSession(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw _mapAuthError(e);
    }
  }

  Future<AppUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    try {
      final response = await _authDio.post(
        '/sign-in/email',
        data: {'email': email, 'password': password},
      );
      return _persistSession(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw _mapAuthError(e);
    }
  }

  /// Signs the user in with Google, then exchanges the Google ID token for a
  /// better-auth session token via `/sign-in/social`.
  Future<AppUser> signInWithGoogle() async {
    try {
      final account = await _googleSignIn.signIn();
      if (account == null) {
        throw ApiException('CANCELLED', 'Google sign-in was cancelled');
      }
      final googleAuth = await account.authentication;
      final idToken = googleAuth.idToken;
      if (idToken == null) {
        throw ApiException('GOOGLE_AUTH_FAILED', 'Could not obtain Google ID token');
      }
      final response = await _authDio.post(
        '/sign-in/social',
        data: {'provider': 'google', 'idToken': idToken},
      );
      return _persistSession(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw _mapAuthError(e);
    }
  }

  Future<void> signOut() async {
    final token = await currentToken();
    if (token != null) {
      try {
        await _authDio.post(
          '/sign-out',
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        );
      } catch (_) {
        // best-effort; still clear local state
      }
    }
    await Future.wait([
      _storage.delete(key: AppConstants.secureStorageTokenKey),
      _storage.delete(key: AppConstants.secureStorageUserIdKey),
      _storage.delete(key: AppConstants.secureStorageUserEmailKey),
    ]);
    try {
      await _googleSignIn.signOut();
    } catch (_) {}
  }

  Future<AppUser> _persistSession(Map<String, dynamic> json) async {
    // better-auth typically returns { token, user: {...} } or nests under "data".
    final body = json.containsKey('data') ? json['data'] as Map<String, dynamic> : json;
    final token = body['token'] as String? ?? body['session']?['token'] as String?;
    final userJson = body['user'] as Map<String, dynamic>?;
    if (token == null || userJson == null) {
      throw ApiException('AUTH_RESPONSE_MALFORMED', 'Unexpected auth response shape');
    }
    final user = AppUser.fromJson(userJson);
    await Future.wait([
      _storage.write(key: AppConstants.secureStorageTokenKey, value: token),
      _storage.write(key: AppConstants.secureStorageUserIdKey, value: user.id),
      _storage.write(key: AppConstants.secureStorageUserEmailKey, value: user.email),
    ]);
    return user;
  }

  ApiException _mapAuthError(DioException e) {
    final data = e.response?.data;
    if (data is Map<String, dynamic>) {
      final error = data['error'];
      if (error is Map<String, dynamic>) {
        return ApiException(
          error['code']?.toString() ?? 'AUTH_ERROR',
          error['message']?.toString() ?? 'Authentication failed',
          statusCode: e.response?.statusCode,
        );
      }
      if (data['message'] != null) {
        return ApiException('AUTH_ERROR', data['message'].toString(), statusCode: e.response?.statusCode);
      }
    }
    return ApiException(
      'NETWORK_ERROR',
      e.message ?? 'Could not reach the server',
      statusCode: e.response?.statusCode,
    );
  }
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(ref.watch(secureStorageProvider));
});

/// Emits the signed-in user (or null) and is refreshed after sign-in/out.
final authStateProvider = FutureProvider<AppUser?>((ref) async {
  ref.watch(authTokenRevisionProvider);
  final repo = ref.watch(authRepositoryProvider);
  final signedIn = await repo.isSignedIn();
  if (!signedIn) return null;
  try {
    final api = ref.watch(apiClientProvider);
    final json = await api.get<Map<String, dynamic>>('/auth/me');
    return AppUser.fromJson(json);
  } catch (_) {
    // Token might be stale/expired; treat as signed out.
    return null;
  }
});
