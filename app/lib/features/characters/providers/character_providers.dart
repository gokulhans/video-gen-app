import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../../core/models/character_voice.dart';
import '../../../core/api_client.dart';
import '../../../core/repositories/asset_repository.dart';
import '../../../core/repositories/character_repository.dart';

class CharacterHubState {
  const CharacterHubState({
    this.voices = const [],
    this.stock = const [],
    this.mine = const [],
    this.mutationError,
  });
  final List<VoiceProfile> voices;
  final List<StockCharacter> stock;
  final List<UserCharacter> mine;
  final String? mutationError;
  CharacterHubState copyWith({
    List<VoiceProfile>? voices,
    List<StockCharacter>? stock,
    List<UserCharacter>? mine,
    String? mutationError,
    bool clearError = false,
  }) => CharacterHubState(
    voices: voices ?? this.voices,
    stock: stock ?? this.stock,
    mine: mine ?? this.mine,
    mutationError: clearError ? null : mutationError ?? this.mutationError,
  );
}

class CharacterHubController
    extends AutoDisposeAsyncNotifier<CharacterHubState> {
  CharacterRepository get _repository => ref.read(characterRepositoryProvider);
  String? _pendingCreateKey;
  PrivateUploadedAsset? _pendingUpload;
  String? _pendingFingerprint;
  @override
  Future<CharacterHubState> build() async {
    final values = await Future.wait([
      _repository.listVoices(),
      _repository.listStockCharacters(),
      _repository.listUserCharacters(),
    ]);
    return CharacterHubState(
      voices: values[0] as List<VoiceProfile>,
      stock: values[1] as List<StockCharacter>,
      mine: values[2] as List<UserCharacter>,
    );
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(build);
  }

  Future<void> toggleFavorite(VoiceProfile voice) async {
    final current = state.valueOrNull;
    if (current == null) return;
    state = AsyncData(
      current.copyWith(
        voices: [
          for (final item in current.voices)
            item.id == voice.id
                ? item.copyWith(isFavorite: !voice.isFavorite)
                : item,
        ],
        clearError: true,
      ),
    );
    try {
      await _repository.setVoiceFavorite(voice.id, !voice.isFavorite);
    } catch (_) {
      state = AsyncData(
        current.copyWith(mutationError: 'Favorite could not be updated.'),
      );
    }
  }

  Future<bool> create({
    required String name,
    required List<int> bytes,
    required String contentType,
    required String consentStatement,
  }) async {
    final current = state.valueOrNull;
    if (current == null) return false;
    final createFingerprint =
        '$name\u0000$contentType\u0000$consentStatement\u0000${bytes.length}\u0000${Object.hashAll(bytes)}';
    PrivateUploadedAsset? upload = _pendingFingerprint == createFingerprint
        ? _pendingUpload
        : null;
    final idempotencyKey = _pendingFingerprint == createFingerprint
        ? _pendingCreateKey ?? const Uuid().v4()
        : const Uuid().v4();
    try {
      upload ??= await ref
          .read(assetRepositoryProvider)
          .uploadPrivateBytes(
            kind: 'image',
            contentType: contentType,
            bytes: bytes,
          );
      _pendingCreateKey = idempotencyKey;
      _pendingUpload = upload;
      _pendingFingerprint = createFingerprint;
      final created = await _repository.createUserCharacter(
        name: name,
        assetId: upload.assetId,
        consentStatement: consentStatement,
        idempotencyKey: idempotencyKey,
      );
      _clearPendingCreate();
      state = AsyncData(
        current.copyWith(mine: [created, ...current.mine], clearError: true),
      );
      return true;
    } catch (error) {
      if (error is ApiException &&
          error.code.toLowerCase() == 'network_error') {
        state = AsyncData(
          current.copyWith(
            mutationError:
                'Connection lost after submission. Retry safely; the same request key will be reused.',
          ),
        );
        return false;
      }
      var cleaned = false;
      if (upload != null) {
        try {
          await ref
              .read(assetRepositoryProvider)
              .deletePrivateUpload(upload.assetId);
          cleaned = true;
        } catch (_) {
          cleaned = false;
        }
      }
      _clearPendingCreate();
      state = AsyncData(
        current.copyWith(
          mutationError: _message(
            error,
            fallback: cleaned
                ? 'Presenter creation did not finish. The unattached private upload was removed.'
                : 'Presenter creation did not finish. Private upload cleanup is pending.',
          ),
        ),
      );
      return false;
    }
  }

  void _clearPendingCreate() {
    _pendingCreateKey = null;
    _pendingUpload = null;
    _pendingFingerprint = null;
  }

  Future<void> archive(UserCharacter item) async {
    final current = state.valueOrNull;
    if (current == null) return;
    try {
      await _repository.archiveUserCharacter(item.id);
      state = AsyncData(
        current.copyWith(
          mine: current.mine.where((e) => e.id != item.id).toList(),
          clearError: true,
        ),
      );
    } catch (error) {
      state = AsyncData(
        current.copyWith(
          mutationError: _message(
            error,
            fallback: 'Presenter could not be archived.',
          ),
        ),
      );
    }
  }

  Future<void> delete(UserCharacter item) async {
    final current = state.valueOrNull;
    if (current == null) return;
    try {
      await _repository.deleteUserCharacter(item.id);
      state = AsyncData(
        current.copyWith(
          mine: current.mine.where((e) => e.id != item.id).toList(),
          clearError: true,
        ),
      );
    } catch (error) {
      state = AsyncData(
        current.copyWith(
          mutationError: _message(
            error,
            fallback: 'Presenter could not be deleted. Try again.',
          ),
        ),
      );
    }
  }

  String _message(Object error, {required String fallback}) {
    if (error is! ApiException) return fallback;
    if (error.code.toLowerCase() == 'conflict') {
      return 'This presenter is used by an existing generation. Archive it instead.';
    }
    if (error.code.toLowerCase() == 'network_error') {
      return 'Connection lost. Nothing was changed; check your network and retry.';
    }
    if (error.code.toLowerCase() == 'service_unavailable') {
      return 'Private media cleanup is temporarily unavailable. Retry safely in a moment.';
    }
    return error.message.isEmpty ? fallback : error.message;
  }
}

final characterHubProvider =
    AutoDisposeAsyncNotifierProvider<CharacterHubController, CharacterHubState>(
      CharacterHubController.new,
    );
