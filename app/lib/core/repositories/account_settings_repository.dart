import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
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
  Future<Map<String, dynamic>> requestExport() => _api.post(
    '/account/export-requests',
    headers: {'Idempotency-Key': const Uuid().v4()},
    parser: (j) => j as Map<String, dynamic>,
  );
  Future<Map<String, dynamic>> requestDeletion() => _api.post(
    '/account/deletion-requests',
    headers: {'Idempotency-Key': const Uuid().v4()},
    parser: (j) => j as Map<String, dynamic>,
  );
}

final accountSettingsRepositoryProvider = Provider(
  (ref) => AccountSettingsRepository(ref.watch(apiClientProvider)),
);
