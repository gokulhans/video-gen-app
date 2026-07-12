import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/composition.dart';
import '../../../core/models/project.dart';
import '../../../core/models/template.dart';
import '../../../core/models/token_balance.dart';
import '../../../core/repositories/project_repository.dart';
import '../../../core/repositories/template_repository.dart';
import '../../../core/repositories/token_repository.dart';

final templatesProvider = FutureProvider.autoDispose<List<VideoTemplate>>((
  ref,
) async {
  return ref.watch(templateRepositoryProvider).listTemplates();
});

final voicesProvider = FutureProvider.autoDispose
    .family<List<VoiceOption>, String>((ref, language) async {
      return ref
          .watch(templateRepositoryProvider)
          .listVoices(language: language);
    });

/// Holds the in-progress "create" form state as the user moves from the
/// template picker to the topic form.
class CreateFormState {
  const CreateFormState({
    this.template,
    this.topic = '',
    this.details = '',
    this.language = 'en',
    this.durationSec = 45,
    this.voice = 'alloy',
    this.brandId,
  });

  final VideoTemplate? template;
  final String topic;
  final String details;
  final String language;
  final int durationSec;
  final String voice;
  final String? brandId;

  CreateFormState copyWith({
    VideoTemplate? template,
    String? topic,
    String? details,
    String? language,
    int? durationSec,
    String? voice,
    String? brandId,
  }) => CreateFormState(
    template: template ?? this.template,
    topic: topic ?? this.topic,
    details: details ?? this.details,
    language: language ?? this.language,
    durationSec: durationSec ?? this.durationSec,
    voice: voice ?? this.voice,
    brandId: brandId ?? this.brandId,
  );
}

class CreateFormController extends StateNotifier<CreateFormState> {
  CreateFormController() : super(const CreateFormState());

  void selectTemplate(VideoTemplate template) {
    state = state.copyWith(
      template: template,
      durationSec: template.defaultDuration,
    );
  }

  void update({
    String? topic,
    String? details,
    String? language,
    int? durationSec,
    String? voice,
    String? brandId,
  }) {
    state = state.copyWith(
      topic: topic,
      details: details,
      language: language,
      durationSec: durationSec,
      voice: voice,
      brandId: brandId,
    );
  }

  void reset() => state = const CreateFormState();
}

final createFormProvider =
    StateNotifierProvider<CreateFormController, CreateFormState>((ref) {
      return CreateFormController();
    });

/// `GET /tokens/cost-estimate?templateId&duration`, refetched whenever the
/// template or duration changes.
final generationCostEstimateProvider = FutureProvider.autoDispose<CostEstimate>(
  (ref) async {
    final form = ref.watch(createFormProvider);
    if (form.template == null) {
      return const CostEstimate(total: 0, breakdown: {});
    }
    final repo = ref.watch(tokenRepositoryProvider);
    return repo.getCostEstimate(
      templateId: form.template!.id,
      durationSec: form.durationSec,
    );
  },
);

enum GenerationLaunchStatus { idle, loading, error }

class GenerationLaunchState {
  const GenerationLaunchState({
    this.status = GenerationLaunchStatus.idle,
    this.errorMessage,
  });
  final GenerationLaunchStatus status;
  final String? errorMessage;
}

/// Creates the draft project then starts the GenerationPipeline Workflow.
class GenerationLaunchController extends StateNotifier<GenerationLaunchState> {
  GenerationLaunchController(this._ref) : super(const GenerationLaunchState());

  final Ref _ref;

  Future<Project?> launch() async {
    final form = _ref.read(createFormProvider);
    if (form.template == null || form.topic.trim().length < 3) {
      state = const GenerationLaunchState(
        status: GenerationLaunchStatus.error,
        errorMessage: 'Pick a template and enter a topic (min 3 characters).',
      );
      return null;
    }
    state = const GenerationLaunchState(status: GenerationLaunchStatus.loading);
    try {
      final repo = _ref.read(projectRepositoryProvider);
      final project = await repo.createProject(
        name: form.topic.trim(),
        templateId: form.template!.id,
        brandId: form.brandId,
      );
      await repo.startGeneration(
        project.id,
        GenerationParams(
          templateId: form.template!.id,
          brandId: form.brandId,
          topic: form.topic.trim(),
          details: form.details.trim(),
          language: form.language,
          durationSec: form.durationSec,
          voice: form.voice,
        ),
      );
      state = const GenerationLaunchState(status: GenerationLaunchStatus.idle);
      return project;
    } catch (e) {
      state = GenerationLaunchState(
        status: GenerationLaunchStatus.error,
        errorMessage: e.toString(),
      );
      return null;
    }
  }
}

final generationLaunchControllerProvider =
    StateNotifierProvider<GenerationLaunchController, GenerationLaunchState>((
      ref,
    ) {
      return GenerationLaunchController(ref);
    });
