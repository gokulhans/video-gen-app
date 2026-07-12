import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants.dart';
import '../../../core/models/composition.dart';
import '../../../core/models/render_job.dart';
import '../../../core/models/token_balance.dart';
import '../../../core/repositories/render_repository.dart';
import '../../../core/repositories/token_repository.dart';

/// `GET /tokens/cost-estimate?action=render_720p|render_1080p`.
final renderCostEstimateProvider = FutureProvider.autoDispose
    .family<CostEstimate, RenderResolution>((ref, resolution) async {
      final action = resolution == RenderResolution.p1080
          ? 'render_1080p'
          : 'render_720p';
      return ref.watch(tokenRepositoryProvider).getActionCostEstimate(action);
    });

/// Starts a render job for a project and returns the created [RenderJob].
final startRenderProvider = FutureProvider.autoDispose
    .family<RenderJob, ({String projectId, RenderResolution resolution})>((
      ref,
      args,
    ) async {
      final repo = ref.watch(renderRepositoryProvider);
      return repo.startRender(args.projectId, args.resolution);
    });

/// Tracks a render job with single-flight polling. Bearer tokens are never put
/// in WebSocket query strings; a short-lived WS-ticket flow can be added later
/// without weakening the HTTP session model.
class RenderProgressController extends StateNotifier<AsyncValue<RenderJob>> {
  RenderProgressController(this._ref, this.jobId)
    : super(const AsyncValue.loading()) {
    _init();
  }

  final Ref _ref;
  final String jobId;
  Timer? _pollTimer;
  bool _fetching = false;

  Future<void> _init() async {
    await _fetchOnce();
    _schedulePoll();
  }

  Future<void> _fetchOnce() async {
    if (_fetching) return;
    _fetching = true;
    try {
      final job = await _ref.read(renderRepositoryProvider).getRenderJob(jobId);
      if (!mounted) return;
      state = AsyncValue.data(job);
    } catch (e, st) {
      if (!mounted) return;
      if (state is! AsyncData) state = AsyncValue.error(e, st);
    } finally {
      _fetching = false;
    }
  }

  void _schedulePoll() {
    if (!mounted) {
      return;
    }
    final status = state.valueOrNull?.status;
    if (status == RenderStatus.completed || status == RenderStatus.failed) {
      return;
    }
    _pollTimer?.cancel();
    _pollTimer = Timer(AppConstants.renderPollInterval, () async {
      await _fetchOnce();
      _schedulePoll();
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }
}

final renderProgressControllerProvider = StateNotifierProvider.autoDispose
    .family<RenderProgressController, AsyncValue<RenderJob>, String>((
      ref,
      jobId,
    ) {
      return RenderProgressController(ref, jobId);
    });
