import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../models/notification.dart';

/// Notifications: list/mark-read; device token registration (CONTRACTS.md).
class NotificationRepository {
  NotificationRepository(this._api);

  final ApiClient _api;

  Future<List<AppNotification>> list() {
    return _api.get<List<AppNotification>>(
      '/notifications',
      parser: (json) => (json as List<dynamic>)
          .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<void> markRead(String id) {
    return _api.patch<void>('/notifications/$id/read');
  }

  Future<void> markAllRead() {
    return _api.patch<void>('/notifications/read-all');
  }

  Future<void> registerDevice({required String fcmToken, required String platform}) {
    return _api.post<void>(
      '/devices',
      body: {'fcmToken': fcmToken, 'platform': platform},
    );
  }
}

final notificationRepositoryProvider = Provider<NotificationRepository>((ref) {
  return NotificationRepository(ref.watch(apiClientProvider));
});
