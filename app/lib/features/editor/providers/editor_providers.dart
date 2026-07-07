import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants.dart';
import '../../../core/models/brand.dart';
import '../../../core/models/composition.dart';
import '../../../core/models/project.dart';
import '../../../core/repositories/brand_repository.dart';
import '../../../core/repositories/project_repository.dart';

/// Loads the project (and its composition) for the editor.
final editorProjectProvider =
    FutureProvider.autoDispose.family<Project, String>((ref, projectId) async {
  final repo = ref.watch(projectRepositoryProvider);
  return repo.getProject(projectId);
});

final brandsProvider = FutureProvider.autoDispose<List<Brand>>((ref) async {
  return ref.watch(brandRepositoryProvider).listBrands();
});

enum AutosaveStatus { idle, saving, saved, error }

/// Owns the live [ProjectComposition] being edited, exposes granular update
/// methods used by each editor tab, and autosaves via a 2s debounce against
/// `PATCH /projects/:id/composition`.
class CompositionController extends StateNotifier<AsyncValue<ProjectComposition>> {
  CompositionController(this._ref, this.projectId) : super(const AsyncValue.loading()) {
    _load();
  }

  final Ref _ref;
  final String projectId;
  Timer? _debounce;
  AutosaveStatus autosaveStatus = AutosaveStatus.idle;
  final _autosaveStatusController = StreamController<AutosaveStatus>.broadcast();
  Stream<AutosaveStatus> get autosaveStatusStream => _autosaveStatusController.stream;

  Future<void> _load() async {
    try {
      final project = await _ref.read(projectRepositoryProvider).getProject(projectId);
      final composition = project.composition ??
          ProjectComposition(durationSec: 45, script: '', voice: 'alloy');
      state = AsyncValue.data(composition);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  void _update(ProjectComposition Function(ProjectComposition) transform) {
    final current = state.valueOrNull;
    if (current == null) return;
    state = AsyncValue.data(transform(current));
    _scheduleAutosave();
  }

  void updateScript(String script) => _update((c) => c.copyWith(script: script));

  void updateSceneText(String sceneId, String text) => _update((c) => c.copyWith(
        scenes: c.scenes.map((s) => s.id == sceneId ? s.copyWith(text: text) : s).toList(),
      ));

  void updateSceneImage(String sceneId, {String? imageUrl, ImageStatus? status}) => _update((c) => c
      .copyWith(
    scenes: c.scenes
        .map((s) => s.id == sceneId ? s.copyWith(imageUrl: imageUrl, imageStatus: status) : s)
        .toList(),
  ));

  void setSceneRegenerating(String sceneId) =>
      updateSceneImage(sceneId, status: ImageStatus.generating);

  void updateVoice(String voice) => _update((c) => c.copyWith(voice: voice));

  void updateVoiceoverUrl(String? url) => _update((c) => c.copyWith(voiceoverUrl: url));

  void updateCaptions(CaptionConfig captions) => _update((c) => c.copyWith(captions: captions));

  void updateMusic({String? musicUrl, double? musicVolume}) =>
      _update((c) => c.copyWith(musicUrl: musicUrl, musicVolume: musicVolume));

  void updateBrand(BrandConfig brand) => _update((c) => c.copyWith(brand: brand));

  void replaceComposition(ProjectComposition composition) {
    state = AsyncValue.data(composition);
    _scheduleAutosave();
  }

  void _scheduleAutosave() {
    _debounce?.cancel();
    _debounce = Timer(AppConstants.autosaveDebounce, _save);
  }

  Future<void> _save() async {
    final composition = state.valueOrNull;
    if (composition == null) return;
    autosaveStatus = AutosaveStatus.saving;
    _autosaveStatusController.add(AutosaveStatus.saving);
    try {
      await _ref.read(projectRepositoryProvider).patchComposition(projectId, composition);
      autosaveStatus = AutosaveStatus.saved;
      _autosaveStatusController.add(AutosaveStatus.saved);
    } catch (_) {
      autosaveStatus = AutosaveStatus.error;
      _autosaveStatusController.add(AutosaveStatus.error);
    }
  }

  /// Forces an immediate save (e.g. before navigating to the render screen).
  Future<void> saveNow() async {
    _debounce?.cancel();
    await _save();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _autosaveStatusController.close();
    super.dispose();
  }
}

final compositionControllerProvider = StateNotifierProvider.autoDispose
    .family<CompositionController, AsyncValue<ProjectComposition>, String>((ref, projectId) {
  return CompositionController(ref, projectId);
});
