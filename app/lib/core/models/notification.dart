import 'package:equatable/equatable.dart';

enum NotificationType {
  renderComplete,
  renderFailed,
  generationComplete,
  system,
}

extension NotificationTypeX on NotificationType {
  static NotificationType fromWire(String? value) => switch (value) {
    'render_complete' => NotificationType.renderComplete,
    'render_failed' => NotificationType.renderFailed,
    'generation_complete' => NotificationType.generationComplete,
    _ => NotificationType.system,
  };
}

/// Mirrors the `notifications` table.
class AppNotification extends Equatable {
  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.message,
    this.projectId,
    this.projectName,
    this.downloadUrl,
    this.jobId,
    this.deepLink,
    this.readAt,
    this.isRead = false,
    required this.createdAt,
  });

  final String id;
  final NotificationType type;
  final String title;
  final String message;
  final String? projectId;
  final String? projectName;
  final String? downloadUrl;
  final String? jobId;
  final String? deepLink;
  final DateTime? readAt;
  final bool isRead;
  final DateTime createdAt;

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        id: json['id'] as String,
        type: NotificationTypeX.fromWire(json['type'] as String?),
        title: json['title'] as String? ?? '',
        message: json['message'] as String? ?? '',
        projectId: json['projectId'] as String?,
        projectName: json['projectName'] as String?,
        downloadUrl: json['downloadUrl'] as String?,
        jobId: json['jobId'] as String?,
        deepLink: json['deepLink'] as String?,
        readAt: json['readAt'] == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(
                (json['readAt'] as num).toInt(),
              ),
        isRead: json['isRead'] as bool? ?? false,
        createdAt: DateTime.fromMillisecondsSinceEpoch(
          (json['createdAt'] as num?)?.toInt() ?? 0,
        ),
      );

  AppNotification copyWith({bool? isRead}) => AppNotification(
    id: id,
    type: type,
    title: title,
    message: message,
    projectId: projectId,
    projectName: projectName,
    downloadUrl: downloadUrl,
    jobId: jobId,
    deepLink: deepLink,
    readAt: readAt,
    isRead: isRead ?? this.isRead,
    createdAt: createdAt,
  );

  @override
  List<Object?> get props => [
    id,
    type,
    title,
    message,
    projectId,
    projectName,
    downloadUrl,
    jobId,
    deepLink,
    readAt,
    isRead,
    createdAt,
  ];
}

class NotificationPage {
  const NotificationPage({required this.items, this.nextCursor});
  final List<AppNotification> items;
  final String? nextCursor;
  factory NotificationPage.fromJson(Map<String, dynamic> json) =>
      NotificationPage(
        items: (json['items'] as List<dynamic>? ?? const [])
            .map(
              (item) => AppNotification.fromJson(item as Map<String, dynamic>),
            )
            .toList(),
        nextCursor: json['nextCursor'] as String?,
      );
}
