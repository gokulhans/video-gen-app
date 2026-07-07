import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../../core/auth_repository.dart';
import '../../../core/constants.dart';
import '../../../core/models/composition.dart';
import '../../../core/models/render_job.dart';
import '../../../core/models/token_balance.dart';
import '../../../core/repositories/render_repository.dart';
import '../../../core/repositories/token_repository.dart';

/// `GET /tokens/cost-estimate?action=render_720p|render_1080p`.
final renderCostEstimateProvider =
    FutureProvider.autoDispose.family<CostEstimate, RenderResolution>((ref, resolution) async {
  final action = resolution == RenderResolution.p1080 ? 'render_1080p' : 'render_720p';
  return ref.watch(tokenRepositoryProvider).getActionCostEstimate(action);
});

/// Starts a render job for a project and returns the created [RenderJob].
final startRenderProvider =
    FutureProvider.autoDispose.family<RenderJob, ({String projectId, RenderResolution resolution})>(
  (ref, args) async {
    final repo = ref.watch(renderRepositoryProvider);
    return repo.startRender(args.projectId, args.resolution);
  },
);

/// Tracks a render job's live progress: subscribes to the RenderJobDO
/// WebSocket (`GET /render-jobs/:id/ws`) and falls back to polling
/// `GET /render-jobs/:id` every 3s if the socket is unavailable or drops.
class RenderProgressController extends StateNotifier<AsyncValue<RenderJob>> {
  RenderProgressController(this._ref, this.jobId) : super(const AsyncValue.loading()) {
    _init();
  }

  final Ref _ref;
  final String jobId;
  WebSocketChannel? _channel;
  Timer? _pollTimer;
  bool _usingSocket = false;

  Future<void> _init() async {
    await _fetchOnce();
    await _connectSocket();
    // Always keep a polling fallback running; it's cheap and guarantees
    // progress keeps moving even if the socket silently stalls.
    _pollTimer = Timer.periodic(AppConstants.renderPollInterval, (_) {
      if (!_usingSocket) _fetchOnce();
    });
  }

  Future<void> _fetchOnce() async {
    try {
      final job = await _ref.read(renderRepositoryProvider).getRenderJob(jobId);
      if (!mounted) return;
      state = AsyncValue.data(job);
    } catch (e, st) {
      if (!mounted) return;
      if (state is! AsyncData) state = AsyncValue.error(e, st);
    }
  }

  Future<void> _connectSocket() async {
    try {
      final repo = _ref.read(renderRepositoryProvider);
      final url = repo.webSocketUrl(jobId);
      final token = await _ref.read(authRepositoryProvider).currentToken();
      final uri = Uri.parse(url).replace(queryParameters: {
        if (token != null) 'token': token,
      });
      final channel = WebSocketChannel.connect(uri);
      _channel = channel;
      channel.stream.listen(
        (event) {
          _usingSocket = true;
          try {
            final json = jsonDecode(event as String) as Map<String, dynamic>;
            final message = RenderProgressMessage.fromJson(json);
            final current = state.valueOrNull;
            if (current != null) {
              state = AsyncValue.data(current.copyWithProgress(message));
            }
          } catch (_) {
            // ignore malformed frames
          }
        },
        onError: (_) {
          _usingSocket = false;
        },
        onDone: () {
          _usingSocket = false;
        },
        cancelOnError: true,
      );
    } catch (_) {
      _usingSocket = false;
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _channel?.sink.close();
    super.dispose();
  }
}

final renderProgressControllerProvider = StateNotifierProvider.autoDispose
    .family<RenderProgressController, AsyncValue<RenderJob>, String>((ref, jobId) {
  return RenderProgressController(ref, jobId);
});
