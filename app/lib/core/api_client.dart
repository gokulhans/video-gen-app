import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'constants.dart';

/// Thrown whenever the API returns the `{ error: { code, message } }` envelope
/// or a transport-level failure occurs.
class ApiException implements Exception {
  ApiException(this.code, this.message, {this.statusCode});

  final String code;
  final String message;
  final int? statusCode;

  bool get isUnauthorized => statusCode == 401;
  bool get isInsufficientTokens => code == 'INSUFFICIENT_TOKENS';

  @override
  String toString() => 'ApiException($code): $message';
}

final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
});

/// Notifier used purely as a signal: bumping it forces [dioProvider]
/// consumers to rebuild after login/logout so the auth header refreshes.
final authTokenRevisionProvider = StateProvider<int>((ref) => 0);

final dioProvider = Provider<Dio>((ref) {
  ref.watch(authTokenRevisionProvider);
  final storage = ref.watch(secureStorageProvider);

  final dio = Dio(
    BaseOptions(
      baseUrl: AppConstants.apiBaseUrl,
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 30),
      contentType: 'application/json',
    ),
  );

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await storage.read(key: AppConstants.secureStorageTokenKey);
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) {
        handler.next(error);
      },
    ),
  );

  if (const bool.fromEnvironment('dart.vm.product') == false) {
    dio.interceptors.add(LogInterceptor(requestBody: true, responseBody: true));
  }

  return dio;
});

/// Wraps a [Dio] instance and unwraps the `{data}` / `{error}` envelope
/// described in CONTRACTS.md, converting failures into [ApiException].
class ApiClient {
  ApiClient(this._dio);

  final Dio _dio;

  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? query,
    T Function(dynamic json)? parser,
  }) {
    return _request(
      () => _dio.get(path, queryParameters: query),
      parser: parser,
    );
  }

  Future<T> post<T>(
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    T Function(dynamic json)? parser,
  }) {
    return _request(
      () => _dio.post(path, data: body, queryParameters: query),
      parser: parser,
    );
  }

  Future<T> patch<T>(
    String path, {
    Object? body,
    T Function(dynamic json)? parser,
  }) {
    return _request(
      () => _dio.patch(path, data: body),
      parser: parser,
    );
  }

  Future<T> put<T>(
    String path, {
    Object? body,
    T Function(dynamic json)? parser,
  }) {
    return _request(
      () => _dio.put(path, data: body),
      parser: parser,
    );
  }

  Future<T> delete<T>(
    String path, {
    T Function(dynamic json)? parser,
  }) {
    return _request(
      () => _dio.delete(path),
      parser: parser,
    );
  }

  Future<Response<dynamic>> download(String url, String savePath) {
    return _dio.download(url, savePath);
  }

  Dio get raw => _dio;

  Future<T> _request<T>(
    Future<Response<dynamic>> Function() call, {
    T Function(dynamic json)? parser,
  }) async {
    try {
      final response = await call();
      final body = response.data;
      if (body is Map<String, dynamic> && body.containsKey('error')) {
        final error = body['error'] as Map<String, dynamic>;
        throw ApiException(
          error['code']?.toString() ?? 'UNKNOWN',
          error['message']?.toString() ?? 'Something went wrong',
          statusCode: response.statusCode,
        );
      }
      final data = body is Map<String, dynamic> && body.containsKey('data')
          ? body['data']
          : body;
      if (parser != null) return parser(data);
      return data as T;
    } on DioException catch (e) {
      final data = e.response?.data;
      if (data is Map<String, dynamic> && data.containsKey('error')) {
        final error = data['error'] as Map<String, dynamic>;
        throw ApiException(
          error['code']?.toString() ?? 'UNKNOWN',
          error['message']?.toString() ?? 'Something went wrong',
          statusCode: e.response?.statusCode,
        );
      }
      throw ApiException(
        'NETWORK_ERROR',
        e.message ?? 'Network error, please check your connection',
        statusCode: e.response?.statusCode,
      );
    }
  }
}

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.watch(dioProvider));
});
