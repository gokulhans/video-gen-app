import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api_client.dart';
import '../models/account_settings.dart';

class AccountSettingsRepository {
  AccountSettingsRepository(this._api);
  final ApiClient _api;
  Future<NotificationPreferences> preferences() => _api.get(
    '/preferences/notifications',
    parser: (j) => NotificationPreferences.fromJson(j as Map<String, dynamic>),
  );
  Future<NotificationPreferences> save(NotificationPreferences value) =>
      _api.put(
        '/preferences/notifications',
        body: value.toJson(),
        parser: (j) =>
            NotificationPreferences.fromJson(j as Map<String, dynamic>),
      );
  Future<Map<String, dynamic>> consentSummary() => _api.get(
    '/preferences/consent-summary',
    parser: (j) => j as Map<String, dynamic>,
  );
  Future<Map<String, dynamic>> requestExport(String idempotencyKey) =>
      _api.post(
        '/account/export-requests',
        headers: {'Idempotency-Key': idempotencyKey},
        parser: (j) => j as Map<String, dynamic>,
      );
  Future<Map<String, dynamic>> requestDeletion(String idempotencyKey) =>
      _api.post(
        '/account/deletion-requests',
        headers: {'Idempotency-Key': idempotencyKey},
        parser: (j) => j as Map<String, dynamic>,
      );
  Future<List<Map<String, dynamic>>> exportRequests() => _api.get(
    '/account/export-requests',
    parser: (j) => (j as List).cast<Map<String, dynamic>>(),
  );
  Future<List<Map<String, dynamic>>> deletionRequests() => _api.get(
    '/account/deletion-requests',
    parser: (j) => (j as List).cast<Map<String, dynamic>>(),
  );
  Future<Map<String, dynamic>> confirmDeletion(String id) => _api.post(
    '/account/deletion-requests/$id/confirm',
    parser: (j) => j as Map<String, dynamic>,
  );
  Future<void> cancelDeletion(String id) =>
      _api.post('/account/deletion-requests/$id/cancel', parser: (_) {});
  Future<String> exportChunkUrl(String requestId, String key) => _api.get(
    '/account/export-requests/$requestId/chunk-url',
    query: {'key': key},
    parser: (j) => (j as Map<String, dynamic>)['url'] as String,
  );
  Future<Map<String, dynamic>> exportManifest(String signedUrl) async =>
      Map<String, dynamic>.from(await _api.getSignedJson(signedUrl) as Map);
  Future<void> downloadSignedFile(String url, String savePath) async {
    await _api.download(url, savePath);
  }
}

final accountSettingsRepositoryProvider = Provider(
  (ref) => AccountSettingsRepository(ref.watch(apiClientProvider)),
);
