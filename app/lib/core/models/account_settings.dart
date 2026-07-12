class NotificationPreferences {
  const NotificationPreferences({
    required this.pushEnabled,
    required this.emailEnabled,
    required this.generationUpdates,
    required this.renderUpdates,
    required this.productUpdates,
  });
  final bool pushEnabled,
      emailEnabled,
      generationUpdates,
      renderUpdates,
      productUpdates;
  factory NotificationPreferences.fromJson(Map<String, dynamic> j) =>
      NotificationPreferences(
        pushEnabled: j['pushEnabled'] as bool? ?? true,
        emailEnabled: j['emailEnabled'] as bool? ?? false,
        generationUpdates: j['generationUpdates'] as bool? ?? true,
        renderUpdates: j['renderUpdates'] as bool? ?? true,
        productUpdates: j['productUpdates'] as bool? ?? false,
      );
  Map<String, dynamic> toJson() => {
    'pushEnabled': pushEnabled,
    'emailEnabled': emailEnabled,
    'generationUpdates': generationUpdates,
    'renderUpdates': renderUpdates,
    'productUpdates': productUpdates,
  };
  NotificationPreferences copyWith({
    bool? pushEnabled,
    bool? emailEnabled,
    bool? generationUpdates,
    bool? renderUpdates,
    bool? productUpdates,
  }) => NotificationPreferences(
    pushEnabled: pushEnabled ?? this.pushEnabled,
    emailEnabled: emailEnabled ?? this.emailEnabled,
    generationUpdates: generationUpdates ?? this.generationUpdates,
    renderUpdates: renderUpdates ?? this.renderUpdates,
    productUpdates: productUpdates ?? this.productUpdates,
  );
}
