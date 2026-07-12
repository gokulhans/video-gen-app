import 'dart:async';

import 'package:ai_video_maker/core/models/character_voice.dart';
import 'package:ai_video_maker/core/repositories/asset_repository.dart';
import 'package:ai_video_maker/core/repositories/character_repository.dart';
import 'package:ai_video_maker/core/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ai_video_maker/design_system/theme/app_theme.dart';
import 'package:ai_video_maker/features/characters/providers/character_providers.dart';
import 'package:ai_video_maker/features/characters/screens/character_screen.dart';

void main() {
  test(
    'presigned upload retains finalized asset id for character creation',
    () {
      final upload = PresignedUpload.fromJson({
        'assetId': 'asset-123',
        'uploadUrl': 'https://upload.example.test',
        'assetKey': 'user-uploads/user/image.jpg',
        'publicUrl': 'https://app.example.test/media/input/old-token',
      });
      expect(upload.assetId, 'asset-123');
    },
  );

  test('user character pending review is never parsed as ready', () {
    final character = UserCharacter.fromJson({
      'id': 'character-1',
      'name': 'Studio host',
      'status': 'pending_review',
      'currentVersionId': 'version-1',
      'createdAt': 1,
      'updatedAt': 2,
      'archivedAt': null,
    });
    expect(character.status, UserCharacterStatus.pendingReview);
    expect(character.status, isNot(UserCharacterStatus.ready));
  });

  test('catalog media URLs are parsed for usable previews', () {
    final voice = VoiceProfile.fromJson({
      'id': 'voice-1',
      'slug': 'warm',
      'name': 'Warm guide',
      'locale': 'en-IN',
      'tags': <String>[],
      'isPremium': false,
      'isFavorite': false,
      'sampleUrl': 'https://signed.test/sample.mp3',
    });
    final stock = StockCharacter.fromJson({
      'id': 'stock-1',
      'slug': 'host',
      'name': 'Host',
      'previewAssetKey': 'characters/host.jpg',
      'tags': <String>[],
      'previewUrl': 'https://signed.test/host.jpg',
    });
    expect(voice.sampleUrl, endsWith('sample.mp3'));
    expect(stock.previewUrl, endsWith('host.jpg'));
  });

  test(
    'ambiguous create retry preserves key and upload without cleanup',
    () async {
      final characters = _RetryCharacterRepository();
      final assets = _FakeAssetRepository();
      final container = ProviderContainer(
        overrides: [
          characterRepositoryProvider.overrideWithValue(characters),
          assetRepositoryProvider.overrideWithValue(assets),
        ],
      );
      addTearDown(container.dispose);
      await container.read(characterHubProvider.future);
      final controller = container.read(characterHubProvider.notifier);
      final first = await controller.create(
        name: 'Host',
        bytes: [1, 2, 3],
        contentType: 'image/jpeg',
        consentStatement: 'I own this source image',
      );
      final second = await controller.create(
        name: 'Host',
        bytes: [1, 2, 3],
        contentType: 'image/jpeg',
        consentStatement: 'I own this source image',
      );
      expect(first, isFalse);
      expect(second, isTrue);
      expect(assets.uploadCalls, 1);
      expect(assets.deleteCalls, 0);
      expect(characters.keys, hasLength(2));
      expect(characters.keys.toSet(), hasLength(1));
    },
  );

  testWidgets('character hub is overflow-free at compact 1.5x text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [characterHubProvider.overrideWith(() => _FakeHub())],
        child: MaterialApp(
          theme: AppTheme.light,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.5)),
            child: child!,
          ),
          home: const Scaffold(body: CharacterScreen()),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    expect(find.text('Your on-screen team'), findsOneWidget);
    expect(find.text('Pending review'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('character hub uses a two-column wide composition', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1180, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(_app(_FakeHub()));
    await tester.pump();
    await tester.pump();
    final presenters = tester.getTopLeft(find.text('Your presenters'));
    final voices = tester.getTopLeft(find.text('Voice library'));
    expect((presenters.dy - voices.dy).abs(), lessThan(2));
    expect(presenters.dx, lessThan(voices.dx));
    expect(tester.takeException(), isNull);
  });

  testWidgets('character hub exposes stable loading and error states', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_LoadingHub()));
    await tester.pump();
    expect(find.text('Loading your team…'), findsOneWidget);

    await tester.pumpWidget(_app(_ErrorHub()));
    await tester.pumpAndSettle();
    expect(
      find.text('Your presenter and voice library could not be loaded.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}

Widget _app(CharacterHubController controller) => ProviderScope(
  key: UniqueKey(),
  overrides: [characterHubProvider.overrideWith(() => controller)],
  child: MaterialApp(
    theme: AppTheme.light,
    home: const Scaffold(body: CharacterScreen()),
  ),
);

class _FakeHub extends CharacterHubController {
  @override
  Future<CharacterHubState> build() async => CharacterHubState(
    voices: const [
      VoiceProfile(
        id: 'v1',
        slug: 'warm',
        name: 'Warm guide',
        locale: 'en-IN',
        tags: ['warm'],
        isPremium: false,
        isFavorite: true,
      ),
    ],
    stock: const [
      StockCharacter(
        id: 's1',
        slug: 'host',
        name: 'Studio host',
        previewAssetKey: 'stock/host.jpg',
        tags: ['business'],
      ),
    ],
    mine: [
      UserCharacter(
        id: 'u1',
        name: 'My presenter',
        status: UserCharacterStatus.pendingReview,
        currentVersionId: 'uv1',
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
      ),
    ],
  );
}

class _LoadingHub extends CharacterHubController {
  @override
  Future<CharacterHubState> build() => Completer<CharacterHubState>().future;
}

class _ErrorHub extends CharacterHubController {
  @override
  Future<CharacterHubState> build() => Future.error(Exception('offline'));
}

class _FakeAssetRepository extends AssetRepository {
  _FakeAssetRepository() : super(ApiClient(Dio()));
  int uploadCalls = 0;
  int deleteCalls = 0;
  @override
  Future<PrivateUploadedAsset> uploadPrivateBytes({
    required String kind,
    required String contentType,
    required List<int> bytes,
    String purpose = 'character_source',
  }) async {
    uploadCalls++;
    return const PrivateUploadedAsset(
      assetId: 'asset-1',
      assetKey: 'user-uploads/u/source.jpg',
    );
  }

  @override
  Future<void> deletePrivateUpload(String assetId) async {
    deleteCalls++;
  }
}

class _RetryCharacterRepository implements CharacterRepository {
  final List<String> keys = [];
  @override
  Future<UserCharacter> createUserCharacter({
    required String name,
    required String assetId,
    required String consentStatement,
    required String idempotencyKey,
  }) async {
    keys.add(idempotencyKey);
    if (keys.length == 1) throw ApiException('NETWORK_ERROR', 'response lost');
    return UserCharacter(
      id: 'character-1',
      name: name,
      status: UserCharacterStatus.pendingReview,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );
  }

  @override
  Future<List<VoiceProfile>> listVoices({String? locale}) async => const [];
  @override
  Future<List<StockCharacter>> listStockCharacters() async => const [];
  @override
  Future<List<UserCharacter>> listUserCharacters() async => const [];
  @override
  Future<void> setVoiceFavorite(String voiceId, bool favorite) async {}
  @override
  Future<void> archiveUserCharacter(String id) async {}
  @override
  Future<void> deleteUserCharacter(String id) async {}
}
