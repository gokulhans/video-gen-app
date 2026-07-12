import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api_client.dart';
import '../models/character_voice.dart';

abstract interface class CharacterRepository {
  Future<List<VoiceProfile>> listVoices({String? locale});
  Future<void> setVoiceFavorite(String voiceId, bool favorite);
  Future<List<StockCharacter>> listStockCharacters();
  Future<List<UserCharacter>> listUserCharacters();
  Future<UserCharacter> createUserCharacter({
    required String name,
    required String assetId,
    required String consentStatement,
    required String idempotencyKey,
  });
  Future<void> archiveUserCharacter(String id);
  Future<void> deleteUserCharacter(String id);
}

class ApiCharacterRepository implements CharacterRepository {
  ApiCharacterRepository(this._api);
  final ApiClient _api;
  @override
  Future<List<VoiceProfile>> listVoices({String? locale}) => _api.get(
    '/voices',
    query: {?locale: locale},
    parser: (json) => (json as List<dynamic>)
        .whereType<Map<String, dynamic>>()
        .map(VoiceProfile.fromJson)
        .toList(growable: false),
  );
  @override
  Future<void> setVoiceFavorite(String id, bool favorite) => favorite
      ? _api.put<void>('/voices/$id/favorite', parser: (_) {})
      : _api.delete<void>('/voices/$id/favorite', parser: (_) {});
  @override
  Future<List<StockCharacter>> listStockCharacters() => _api.get(
    '/characters/stock',
    parser: (json) => (json as List<dynamic>)
        .whereType<Map<String, dynamic>>()
        .map(StockCharacter.fromJson)
        .toList(growable: false),
  );
  @override
  Future<List<UserCharacter>> listUserCharacters() => _api.get(
    '/characters/mine',
    parser: (json) => (json as List<dynamic>)
        .whereType<Map<String, dynamic>>()
        .map(UserCharacter.fromJson)
        .toList(growable: false),
  );
  @override
  Future<UserCharacter> createUserCharacter({
    required String name,
    required String assetId,
    required String consentStatement,
    required String idempotencyKey,
  }) => _api.post(
    '/characters/mine',
    body: {
      'name': name,
      'assetId': assetId,
      'consent': {'confirmed': true, 'statement': consentStatement},
    },
    headers: {'Idempotency-Key': idempotencyKey},
    parser: (json) => UserCharacter.fromJson(json as Map<String, dynamic>),
  );
  @override
  Future<void> archiveUserCharacter(String id) =>
      _api.patch<void>('/characters/mine/$id/archive', parser: (_) {});
  @override
  Future<void> deleteUserCharacter(String id) =>
      _api.delete<void>('/characters/mine/$id', parser: (_) {});
}

final characterRepositoryProvider = Provider<CharacterRepository>(
  (ref) => ApiCharacterRepository(ref.watch(apiClientProvider)),
);
