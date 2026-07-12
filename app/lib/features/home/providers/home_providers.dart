import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/project.dart';
import '../../../core/repositories/project_repository.dart';

/// The user's project list, refreshable via pull-to-refresh.
final projectListProvider = FutureProvider.autoDispose<List<Project>>((
  ref,
) async {
  final repo = ref.watch(projectRepositoryProvider);
  final projects = await repo.listProjects();
  return projects..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
});
