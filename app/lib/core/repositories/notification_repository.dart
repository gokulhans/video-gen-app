import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api_client.dart';
import '../models/notification.dart';

class NotificationRepository {
  NotificationRepository(this._api);
  final ApiClient _api;
  Future<NotificationPage> list({String? cursor, int limit = 30}) => _api.get(
    '/notifications',
    query: {'limit': limit, if (cursor != null) 'cursor': cursor},
    parser: (json) => NotificationPage.fromJson(json as Map<String, dynamic>),
  );
  Future<int> unreadCount() => _api.get(
    '/notifications/unread-count',
    parser: (json) => (json as Map<String, dynamic>)['count'] as int,
  );
  Future<void> markRead(String id) =>
      _api.post('/notifications/$id/read', parser: (_) {});
  Future<void> markAllRead() =>
      _api.post('/notifications/read-all', parser: (_) {});
  Future<void> registerDevice({
    required String fcmToken,
    required String platform,
  }) => _api.post(
    '/devices/register',
    body: {'fcmToken': fcmToken, 'platform': platform},
    parser: (_) {},
  );
  Future<void> unregisterDevice(String fcmToken) => _api.post(
    '/devices/unregister',
    body: {'fcmToken': fcmToken},
    parser: (_) {},
  );
}

final notificationRepositoryProvider = Provider(
  (ref) => NotificationRepository(ref.watch(apiClientProvider)),
);
