import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/models/notification.dart';
import '../../../core/repositories/notification_repository.dart';
import '../../../design_system/tokens/app_breakpoints.dart';
import '../../../design_system/tokens/app_spacing.dart';
import '../providers/notification_providers.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsState();
}

class _NotificationsState extends ConsumerState<NotificationsScreen> {
  final List<AppNotification> older = [];
  String? cursor;
  bool loadingMore = false;
  String? loadMoreError;
  String? firstPageSignature;
  int pageGeneration = 0;
  @override
  Widget build(BuildContext context) {
    final first = ref.watch(notificationPageProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: () async {
              await ref.read(notificationRepositoryProvider).markAllRead();
              older.clear();
              ref.invalidate(notificationPageProvider);
              ref.invalidate(unreadNotificationCountProvider);
            },
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: first.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Notifications could not be loaded.'),
              TextButton(
                onPressed: () => ref.invalidate(notificationPageProvider),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (page) {
          final signature =
              '${page.nextCursor}|${page.items.map((item) => '${item.id}:${item.isRead}').join(',')}';
          if (firstPageSignature != signature) {
            pageGeneration++;
            firstPageSignature = signature;
            older.clear();
            cursor = page.nextCursor;
            loadMoreError = null;
          }
          final byId = <String, AppNotification>{
            for (final item in [...page.items, ...older]) item.id: item,
          };
          final items = byId.values.toList();
          if (items.isEmpty)
            return const Center(child: Text('No notifications yet'));
          return LayoutBuilder(
            builder: (context, constraints) {
              final width =
                  constraints.maxWidth >= AppBreakpoints.navigationRail
                  ? 760.0
                  : constraints.maxWidth;
              return Align(
                alignment: Alignment.topCenter,
                child: SizedBox(
                  width: width,
                  child: RefreshIndicator(
                    onRefresh: () async {
                      setState(() {
                        pageGeneration++;
                        older.clear();
                        cursor = null;
                        firstPageSignature = null;
                        loadMoreError = null;
                      });
                      ref.invalidate(notificationPageProvider);
                      await ref.read(notificationPageProvider.future);
                    },
                    child: ListView.separated(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      itemCount: items.length + (cursor == null ? 0 : 1),
                      separatorBuilder: (_, _) =>
                          const SizedBox(height: AppSpacing.xs),
                      itemBuilder: (context, index) {
                        if (index == items.length)
                          return Center(
                            child: TextButton.icon(
                              onPressed: loadingMore ? null : _loadMore,
                              icon: loadingMore
                                  ? const SizedBox.square(
                                      dimension: 16,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : const Icon(Icons.expand_more),
                              label: Text(
                                loadMoreError == null
                                    ? 'Load older'
                                    : 'Retry loading older',
                              ),
                            ),
                          );
                        final item = items[index];
                        return Card(
                          child: ListTile(
                            leading: Icon(
                              item.isRead
                                  ? Icons.notifications_none
                                  : Icons.notifications_active_rounded,
                            ),
                            title: Text(
                              item.title,
                              style: TextStyle(
                                fontWeight: item.isRead
                                    ? FontWeight.w500
                                    : FontWeight.w700,
                              ),
                            ),
                            subtitle: Text(
                              item.message,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: Text(
                              DateFormat.MMMd().format(item.createdAt),
                            ),
                            onTap: () => _open(item),
                          ),
                        );
                      },
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }

  Future<void> _loadMore() async {
    if (cursor == null) return;
    final requestedCursor = cursor!;
    final requestedGeneration = pageGeneration;
    setState(() => loadingMore = true);
    try {
      final page = await ref
          .read(notificationRepositoryProvider)
          .list(cursor: requestedCursor);
      if (mounted &&
          requestedGeneration == pageGeneration &&
          cursor == requestedCursor)
        setState(() {
          final existing = older.map((item) => item.id).toSet();
          older.addAll(page.items.where((item) => existing.add(item.id)));
          cursor = page.nextCursor;
          loadMoreError = null;
        });
    } catch (_) {
      if (mounted && requestedGeneration == pageGeneration)
        setState(() => loadMoreError = 'Unable to load older notifications');
    } finally {
      if (mounted && requestedGeneration == pageGeneration) {
        setState(() => loadingMore = false);
      }
    }
  }

  Future<void> _open(AppNotification item) async {
    if (!item.isRead) {
      final index = older.indexWhere((value) => value.id == item.id);
      if (index >= 0)
        setState(() => older[index] = older[index].copyWith(isRead: true));
      try {
        await ref.read(notificationRepositoryProvider).markRead(item.id);
        ref.invalidate(notificationPageProvider);
        ref.invalidate(unreadNotificationCountProvider);
      } catch (_) {
        if (index >= 0 && mounted) setState(() => older[index] = item);
        if (mounted)
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Could not mark notification as read'),
            ),
          );
        return;
      }
    }
    if (mounted && item.deepLink != null) context.push(item.deepLink!);
  }
}
