import 'package:equatable/equatable.dart';

enum NotificationType { renderComplete, renderFailed, generationComplete, system }

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
  final bool isRead;
  final DateTime createdAt;

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: json['id'] as String,
        type: NotificationTypeX.fromWire(json['type'] as String?),
        title: json['title'] as String? ?? '',
        message: json['message'] as String? ?? '',
        projectId: json['projectId'] as String?,
        projectName: json['projectName'] as String?,
        downloadUrl: json['downloadUrl'] as String?,
        isRead: json['isRead'] as bool? ?? false,
        createdAt: DateTime.fromMillisecondsSinceEpoch((json['createdAt'] as num?)?.toInt() ?? 0),
      );

  AppNotification copyWith({bool? isRead}) => AppNotification(
        id: id,
        type: type,
        title: title,
        message: message,
        projectId: projectId,
        projectName: projectName,
        downloadUrl: downloadUrl,
        isRead: isRead ?? this.isRead,
        createdAt: createdAt,
      );

  @override
  List<Object?> get props =>
      [id, type, title, message, projectId, projectName, downloadUrl, isRead, createdAt];
}
