import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../core/models/generation.dart';
import '../../../core/repositories/generation_repository.dart';

class GenerationSubmissionState {
  const GenerationSubmissionState({
    this.quote,
    this.job,
    this.errorMessage,
    this.isQuoting = false,
    this.isSubmitting = false,
  });
  final GenerationQuote? quote;
  final GenerationJob? job;
  final String? errorMessage;
  final bool isQuoting;
  final bool isSubmitting;
  GenerationSubmissionState copyWith({
    GenerationQuote? quote,
    GenerationJob? job,
    String? errorMessage,
    bool clearError = false,
    bool? isQuoting,
    bool? isSubmitting,
  }) => GenerationSubmissionState(
    quote: quote ?? this.quote,
    job: job ?? this.job,
    errorMessage: clearError ? null : errorMessage ?? this.errorMessage,
    isQuoting: isQuoting ?? this.isQuoting,
    isSubmitting: isSubmitting ?? this.isSubmitting,
  );
}

class GenerationSubmissionController
    extends StateNotifier<GenerationSubmissionState> {
  GenerationSubmissionController(this._repository)
    : super(const GenerationSubmissionState());
  final GenerationRepository _repository;
  String? _idempotencyKey;
  GenerationSelection? _selection;

  Future<GenerationQuote?> requestQuote(GenerationSelection selection) async {
    state = const GenerationSubmissionState(isQuoting: true);
    try {
      final quote = await _repository.quote(selection);
      _selection = selection;
      _idempotencyKey = const Uuid().v4();
      state = GenerationSubmissionState(quote: quote);
      return quote;
    } catch (_) {
      state = const GenerationSubmissionState(
        errorMessage:
            'We could not price this video. Check your inputs and try again.',
      );
      return null;
    }
  }

  Future<GenerationJob?> submitQuotedJob() async {
    final quote = state.quote;
    final selection = _selection;
    final key = _idempotencyKey;
    if (quote == null || selection == null || key == null) return null;
    state = state.copyWith(isSubmitting: true, clearError: true);
    try {
      final job = await _repository.createJob(
        selection: selection,
        quoteId: quote.quoteId,
        idempotencyKey: key,
      );
      state = state.copyWith(job: job, isSubmitting: false);
      return job;
    } catch (_) {
      // The same key is deliberately retained. A transport retry must replay,
      // never reserve credits for a second generation.
      state = state.copyWith(
        isSubmitting: false,
        errorMessage:
            'The generation could not be started. Retrying is safe and will not charge twice.',
      );
      return null;
    }
  }
}

final generationSubmissionProvider =
    StateNotifierProvider.autoDispose<
      GenerationSubmissionController,
      GenerationSubmissionState
    >((ref) {
      return GenerationSubmissionController(
        ref.watch(generationRepositoryProvider),
      );
    });

final generationPollBaseIntervalProvider = Provider<Duration>(
  (ref) => const Duration(seconds: 2),
);

final generationJobProvider = StreamProvider.autoDispose
    .family<GenerationJob, String>((ref, jobId) {
      final repository = ref.watch(generationRepositoryProvider);
      final baseInterval = ref.watch(generationPollBaseIntervalProvider);
      final controller = StreamController<GenerationJob>();
      Timer? timer;
      var disposed = false;
      var interval = baseInterval;

      Future<void> poll() async {
        if (disposed) return;
        try {
          final job = await repository.getJob(jobId);
          if (disposed) return;
          controller.add(job);
          if (job.status.isTerminal) {
            await controller.close();
            return;
          }
          timer = Timer(interval, () => unawaited(poll()));
          final maximum = baseInterval * 4;
          if (interval < maximum) interval += baseInterval ~/ 2;
        } catch (error, stackTrace) {
          if (!disposed) controller.addError(error, stackTrace);
        }
      }

      ref.onDispose(() {
        disposed = true;
        timer?.cancel();
        if (!controller.isClosed) unawaited(controller.close());
      });
      unawaited(poll());
      return controller.stream;
    });

final generationAssetDeliveryProvider = FutureProvider.autoDispose
    .family<GenerationAssetDelivery, String>((ref, assetId) {
      return ref.watch(generationRepositoryProvider).getAssetDelivery(assetId);
    });
