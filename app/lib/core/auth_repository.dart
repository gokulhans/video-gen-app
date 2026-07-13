import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'api_client.dart';
import 'auth_debug.dart';
import 'constants.dart';
import 'models/user.dart';

/// Better Auth expects native-provider ID tokens as an object, not a raw
/// string. Keeping the payload builder separate makes this contract testable.
Map<String, dynamic> googleIdTokenSignInBody(String idToken) => {
  'provider': 'google',
  'idToken': {'token': idToken},
};

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

  Future<String?> currentToken() =>
      _storage.read(key: AppConstants.secureStorageTokenKey);

  Future<bool> isSignedIn() async {
    final token = await currentToken();
    return token != null && token.isNotEmpty;
  }

  Future<AppUser> signUpWithEmail({
    required String name,
    required String email,
    required String password,
  }) async {
    authDebug(
      'Email sign-up request started: endpoint=/sign-up/email, '
      'nameLength=${name.trim().length}, email=${authEmailHint(email)}',
    );
    try {
      final response = await _authDio.post(
        '/sign-up/email',
        data: {'name': name, 'email': email, 'password': password},
      );
      authDebug(
        'Email sign-up response received: status=${response.statusCode}',
      );
      return _persistSession(response);
    } on DioException catch (e) {
      authDebug('Email sign-up request failed: ${_dioFailureSummary(e)}');
      throw _mapAuthError(e);
    }
  }

  Future<AppUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    authDebug(
      'Email sign-in request started: endpoint=/sign-in/email, '
      'email=${authEmailHint(email)}',
    );
    try {
      final response = await _authDio.post(
        '/sign-in/email',
        data: {'email': email, 'password': password},
      );
      authDebug(
        'Email sign-in response received: status=${response.statusCode}',
      );
      return _persistSession(response);
    } on DioException catch (e) {
      authDebug('Email sign-in request failed: ${_dioFailureSummary(e)}');
      throw _mapAuthError(e);
    }
  }

  /// Signs the user in with Google, then exchanges the Google ID token for a
  /// better-auth session token via `/sign-in/social`.
  Future<AppUser> signInWithGoogle() async {
    authDebug('Google sign-in started: opening native account picker');
    try {
      final account = await _googleSignIn.signIn();
      if (account == null) {
        authDebug('Google sign-in cancelled before an account was selected');
        throw ApiException('CANCELLED', 'Google sign-in was cancelled');
      }
      authDebug(
        'Google account selected: email=${authEmailHint(account.email)}',
      );
      final googleAuth = await account.authentication;
      final idToken = googleAuth.idToken;
      if (idToken == null) {
        authDebug(
          'Google sign-in failed: native provider returned no ID token',
        );
        throw ApiException(
          'GOOGLE_AUTH_FAILED',
          'Could not obtain Google ID token',
        );
      }
      authDebug(
        'Google ID token received; exchanging with endpoint=/sign-in/social',
      );
      final response = await _authDio.post(
        '/sign-in/social',
        data: googleIdTokenSignInBody(idToken),
      );
      authDebug(
        'Google sign-in exchange response received: status=${response.statusCode}',
      );
      return _persistSession(response);
    } on DioException catch (e) {
      authDebug('Google sign-in request failed: ${_dioFailureSummary(e)}');
      throw _mapAuthError(e);
    }
  }

  Future<void> signOut() async {
    final token = await currentToken();
    authDebug(
      'Repository sign-out started; localTokenPresent=${token != null}',
    );
    if (token != null) {
      try {
        final response = await _authDio.post(
          '/sign-out',
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        );
        authDebug(
          'Repository sign-out endpoint completed: status=${response.statusCode}',
        );
      } on DioException catch (e) {
        authDebug(
          'Repository sign-out endpoint failed; clearing local state anyway: '
          '${_dioFailureSummary(e)}',
        );
      } catch (error) {
        authDebug(
          'Repository sign-out endpoint failed unexpectedly; clearing local '
          'state anyway: $error',
        );
        // best-effort; still clear local state
      }
    }
    await Future.wait([
      _storage.delete(key: AppConstants.secureStorageTokenKey),
      _storage.delete(key: AppConstants.secureStorageUserIdKey),
      _storage.delete(key: AppConstants.secureStorageUserEmailKey),
    ]);
    authDebug('Repository sign-out cleared local session storage');
    try {
      await _googleSignIn.signOut();
      authDebug('Repository sign-out completed Google provider cleanup');
    } catch (error) {
      authDebug('Repository sign-out Google cleanup skipped: $error');
    }
  }

  /// Validates the stored bearer token against better-auth's `/get-session`.
  Future<AppUser?> fetchCurrentUser() async {
    final token = await currentToken();
    if (token == null || token.isEmpty) {
      authDebug('Session check skipped: no local bearer token');
      return null;
    }
    authDebug('Session check started: endpoint=/get-session');
    try {
      final response = await _authDio.get(
        '/get-session',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      authDebug(
        'Session check response received: status=${response.statusCode}',
      );
      final data = response.data;
      if (data == null) {
        authDebug('Session check returned an empty response body');
        return null;
      }
      final body = data is Map<String, dynamic>
          ? (data.containsKey('data')
                ? data['data'] as Map<String, dynamic>
                : data)
          : null;
      final userJson = body?['user'] as Map<String, dynamic>?;
      if (userJson == null) {
        authDebug('Session check returned no user object');
        return null;
      }
      final user = AppUser.fromJson(userJson);
      authDebug(
        'Session check succeeded for ${authEmailHint(user.email)} (userId=${user.id})',
      );
      return user;
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      authDebug('Session check failed: ${_dioFailureSummary(error)}');
      if (status == 401 || status == 403) {
        authDebug(
          'Session check rejected local session; treating user as signed out',
        );
        return null;
      }
      // Preserve a locally authenticated session during transient offline/5xx
      // failures. A definitive auth rejection above is the only condition that
      // signs the user out.
      final values = await Future.wait([
        _storage.read(key: AppConstants.secureStorageUserIdKey),
        _storage.read(key: AppConstants.secureStorageUserEmailKey),
      ]);
      final id = values[0];
      final email = values[1];
      if (id != null && email != null) {
        authDebug(
          'Session check unavailable; preserving local session for '
          '${authEmailHint(email)} (userId=$id)',
        );
        return AppUser(id: id, name: email, email: email);
      }
      authDebug(
        'Session check unavailable and local fallback data is incomplete',
      );
      throw _mapAuthError(error);
    }
  }

  Future<AppUser> _persistSession(Response<dynamic> response) async {
    // better-auth bearer plugin returns the token in `set-auth-token`; body may
    // also include `{ token, user }` (or nested under "data").
    final json = response.data;
    if (json is! Map<String, dynamic>) {
      authDebug(
        'Session persistence failed: response body is not a JSON object',
      );
      throw ApiException(
        'AUTH_RESPONSE_MALFORMED',
        'Unexpected auth response shape',
      );
    }
    final body = json.containsKey('data')
        ? json['data'] as Map<String, dynamic>
        : json;
    final token =
        response.headers.value('set-auth-token') ??
        body['token'] as String? ??
        body['session']?['token'] as String?;
    final userJson = body['user'] as Map<String, dynamic>?;
    if (token == null || userJson == null) {
      authDebug(
        'Session persistence failed: tokenPresent=${token != null}, '
        'userPresent=${userJson != null}, bodyKeys=${body.keys.toList()}',
      );
      throw ApiException(
        'AUTH_RESPONSE_MALFORMED',
        'Unexpected auth response shape',
      );
    }
    final user = AppUser.fromJson(userJson);
    final tokenSource = response.headers.value('set-auth-token') != null
        ? 'header'
        : body['token'] is String
        ? 'body.token'
        : 'body.session.token';
    authDebug(
      'Session persistence received valid auth response: tokenSource=$tokenSource, '
      'user=${authEmailHint(user.email)} (userId=${user.id})',
    );
    await Future.wait([
      _storage.write(key: AppConstants.secureStorageTokenKey, value: token),
      _storage.write(key: AppConstants.secureStorageUserIdKey, value: user.id),
      _storage.write(
        key: AppConstants.secureStorageUserEmailKey,
        value: user.email,
      ),
    ]);
    authDebug('Session persistence completed local storage writes');
    return user;
  }

  ApiException _mapAuthError(DioException e) {
    authDebug('Mapping auth transport error: ${_dioFailureSummary(e)}');
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
        return ApiException(
          'AUTH_ERROR',
          data['message'].toString(),
          statusCode: e.response?.statusCode,
        );
      }
    }
    return ApiException(
      'NETWORK_ERROR',
      e.message ?? 'Could not reach the server',
      statusCode: e.response?.statusCode,
    );
  }

  String _dioFailureSummary(DioException error) {
    final path = error.requestOptions.path;
    return 'type=${error.type}, status=${error.response?.statusCode}, path=$path';
  }
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(ref.watch(secureStorageProvider));
});

/// Emits the signed-in user (or null) and is refreshed after sign-in/out.
final authStateProvider = FutureProvider<AppUser?>((ref) async {
  ref.watch(authTokenRevisionProvider);
  final repo = ref.watch(authRepositoryProvider);
  authDebug('Auth state provider refreshing current session');
  final user = await repo.fetchCurrentUser();
  authDebug(
    user == null
        ? 'Auth state provider resolved signed-out'
        : 'Auth state provider resolved signed-in user=${authEmailHint(user.email)}',
  );
  return user;
});
