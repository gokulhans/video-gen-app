import 'package:flutter/material.dart';

import '../../../core/models/project.dart';
import '../../../design_system/components/status_badge.dart';

class ProjectStatusChipView extends StatelessWidget {
  const ProjectStatusChipView({super.key, required this.status});

  final ProjectStatusChip status;

  @override
  Widget build(BuildContext context) {
    final (label, appStatus) = switch (status) {
      ProjectStatusChip.draft => ('Draft', AppStatus.neutral),
      ProjectStatusChip.generating => ('Generating', AppStatus.generating),
      ProjectStatusChip.ready => ('Ready', AppStatus.success),
      ProjectStatusChip.rendering => ('Rendering', AppStatus.info),
      ProjectStatusChip.failed => ('Failed', AppStatus.error),
    };
    return StatusBadge(label: label, status: appStatus);
  }
}
