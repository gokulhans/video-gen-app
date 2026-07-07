import 'package:flutter/material.dart';

import '../../../core/models/project.dart';

class ProjectStatusChipView extends StatelessWidget {
  const ProjectStatusChipView({super.key, required this.status});

  final ProjectStatusChip status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      ProjectStatusChip.draft => ('Draft', Colors.grey),
      ProjectStatusChip.generating => ('Generating', Colors.orange),
      ProjectStatusChip.ready => ('Ready', Colors.green),
      ProjectStatusChip.rendering => ('Rendering', Colors.blue),
      ProjectStatusChip.failed => ('Failed', Colors.red),
    };
    return Chip(
      label: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
      backgroundColor: color.withValues(alpha: 0.15),
      labelStyle: TextStyle(color: color),
      visualDensity: VisualDensity.compact,
      side: BorderSide.none,
      padding: const EdgeInsets.symmetric(horizontal: 4),
    );
  }
}
