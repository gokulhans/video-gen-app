import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/notification.dart';
import '../../../core/repositories/notification_repository.dart';

final notificationListProvider =
    FutureProvider.autoDispose<List<AppNotification>>((ref) async {
      final repo = ref.watch(notificationRepositoryProvider);
      return repo.list();
    });

/// Count of unread notifications, used for a badge on the home app bar.
final unreadNotificationCountProvider = Provider.autoDispose<int>((ref) {
  final notifications =
      ref.watch(notificationListProvider).valueOrNull ?? const [];
  return notifications.where((n) => !n.isRead).length;
});
