import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/models/notification.dart';
import '../../../core/repositories/notification_repository.dart';
import '../providers/notification_providers.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notificationsAsync = ref.watch(notificationListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: () async {
              await ref.read(notificationRepositoryProvider).markAllRead();
              ref.invalidate(notificationListProvider);
            },
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(notificationListProvider);
          await ref.read(notificationListProvider.future);
        },
        child: notificationsAsync.when(
          data: (notifications) {
            if (notifications.isEmpty) {
              return LayoutBuilder(
                builder: (context, constraints) => SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      minHeight: constraints.maxHeight,
                    ),
                    child: const Center(child: Text('No notifications yet')),
                  ),
                ),
              );
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: notifications.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final notification = notifications[index];
                return ListTile(
                  leading: _iconFor(notification.type),
                  title: Text(
                    notification.title,
                    style: TextStyle(
                      fontWeight: notification.isRead
                          ? FontWeight.normal
                          : FontWeight.bold,
                    ),
                  ),
                  subtitle: Text(notification.message),
                  trailing: Text(
                    DateFormat.MMMd().add_jm().format(notification.createdAt),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  onTap: () async {
                    if (!notification.isRead) {
                      await ref
                          .read(notificationRepositoryProvider)
                          .markRead(notification.id);
                      ref.invalidate(notificationListProvider);
                    }
                    if (notification.projectId != null && context.mounted) {
                      context.push('/editor/${notification.projectId}');
                    }
                  },
                );
              },
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(child: Text('$error')),
        ),
      ),
    );
  }

  Widget _iconFor(NotificationType type) => switch (type) {
    NotificationType.renderComplete => const Icon(
      Icons.check_circle_outline,
      color: Colors.green,
    ),
    NotificationType.renderFailed => const Icon(
      Icons.error_outline,
      color: Colors.red,
    ),
    NotificationType.generationComplete => const Icon(
      Icons.auto_awesome,
      color: Colors.purple,
    ),
    NotificationType.system => const Icon(Icons.info_outline),
  };
}
