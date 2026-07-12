import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/generation.dart';
import '../../../core/repositories/generation_repository.dart';

class HistoryState {
  const HistoryState({
    this.jobs = const [],
    this.nextCursor,
    this.filter,
    this.isLoadingMore = false,
    this.loadMoreError = false,
  });
  final List<GenerationJob> jobs;
  final String? nextCursor;
  final GenerationJobStatus? filter;
  final bool isLoadingMore;
  final bool loadMoreError;
  bool get hasMore => nextCursor != null;
  HistoryState copyWith({
    List<GenerationJob>? jobs,
    String? nextCursor,
    bool clearCursor = false,
    GenerationJobStatus? filter,
    bool clearFilter = false,
    bool? isLoadingMore,
    bool? loadMoreError,
  }) => HistoryState(
    jobs: jobs ?? this.jobs,
    nextCursor: clearCursor ? null : nextCursor ?? this.nextCursor,
    filter: clearFilter ? null : filter ?? this.filter,
    isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    loadMoreError: loadMoreError ?? this.loadMoreError,
  );
}

class HistoryController extends AutoDisposeAsyncNotifier<HistoryState> {
  GenerationRepository get _repository =>
      ref.read(generationRepositoryProvider);

  @override
  Future<HistoryState> build() => _load(null);

  Future<HistoryState> _load(GenerationJobStatus? filter) async {
    final page = await _repository.listJobs(status: filter);
    return HistoryState(
      jobs: page.items,
      nextCursor: page.nextCursor,
      filter: filter,
    );
  }

  Future<void> refresh() async {
    final filter = state.valueOrNull?.filter;
    state = const AsyncLoading();
    state = await AsyncValue.guard(() => _load(filter));
  }

  Future<void> setFilter(GenerationJobStatus? filter) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() => _load(filter));
  }

  Future<void> loadMore() async {
    final current = state.valueOrNull;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData(
      current.copyWith(isLoadingMore: true, loadMoreError: false),
    );
    try {
      final page = await _repository.listJobs(
        cursor: current.nextCursor,
        status: current.filter,
      );
      state = AsyncData(
        current.copyWith(
          jobs: [...current.jobs, ...page.items],
          nextCursor: page.nextCursor,
          clearCursor: page.nextCursor == null,
          isLoadingMore: false,
        ),
      );
    } catch (_) {
      state = AsyncData(
        current.copyWith(isLoadingMore: false, loadMoreError: true),
      );
    }
  }
}

final historyProvider =
    AutoDisposeAsyncNotifierProvider<HistoryController, HistoryState>(
      HistoryController.new,
    );
