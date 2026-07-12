import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/models/notification.dart';
import '../../../core/repositories/notification_repository.dart';

final notificationPageProvider = FutureProvider.autoDispose<NotificationPage>(
  (ref) => ref.watch(notificationRepositoryProvider).list(),
);
final notificationListProvider =
    FutureProvider.autoDispose<List<AppNotification>>(
      (ref) async => (await ref.watch(notificationPageProvider.future)).items,
    );
final unreadNotificationCountProvider = FutureProvider.autoDispose<int>(
  (ref) => ref.watch(notificationRepositoryProvider).unreadCount(),
);
