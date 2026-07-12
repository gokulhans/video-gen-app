import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';

/// Presigned R2 upload/download URLs (`assets` routes in CONTRACTS.md).
class AssetRepository {
  AssetRepository(this._api);

  final ApiClient _api;

  /// Requests a presigned PUT URL to upload a file (e.g. a gallery image
  /// used to replace a generated scene image, or a brand logo).
  Future<PresignedUpload> getUploadUrl({
    required String kind,
    required String contentType,
    required int sizeBytes,
  }) {
    return _api.post<PresignedUpload>(
      '/assets/upload-url',
      body: {'kind': kind, 'contentType': contentType, 'sizeBytes': sizeBytes},
      parser: (json) => PresignedUpload.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<String> getDownloadUrl(String assetKey, {String bucket = 'assets'}) {
    return _api.post<String>(
      '/assets/download-url',
      body: {'bucket': bucket, 'key': assetKey},
      parser: (json) => (json as Map<String, dynamic>)['downloadUrl'] as String,
    );
  }

  Future<UploadedAsset> uploadBytes({
    required String kind,
    required String contentType,
    required List<int> bytes,
  }) async {
    final target = await getUploadUrl(
      kind: kind,
      contentType: contentType,
      sizeBytes: bytes.length,
    );
    await _api.putPresigned(target.uploadUrl, bytes, contentType: contentType);
    await _api.post<void>('/assets/${target.assetId}/finalize', parser: (_) {});
    final providerUrl = await _api.post<String>(
      '/assets/${target.assetId}/provider-url',
      parser: (json) =>
          (json as Map<String, dynamic>)['providerFetchUrl'] as String,
    );
    return UploadedAsset(
      assetId: target.assetId,
      assetKey: target.assetKey,
      publicUrl: providerUrl,
    );
  }

  /// Uploads and finalizes a tenant-private source without minting a provider
  /// fetch URL. Character moderation consumes only the opaque [assetId].
  Future<PrivateUploadedAsset> uploadPrivateBytes({
    required String kind,
    required String contentType,
    required List<int> bytes,
    String purpose = 'character_source',
  }) async {
    final target = await _api.post<PresignedUpload>(
      '/assets/upload-private-url',
      body: {
        'kind': kind,
        'contentType': contentType,
        'sizeBytes': bytes.length,
        'purpose': purpose,
      },
      parser: (json) => PresignedUpload.fromJson(
        json as Map<String, dynamic>,
        requirePublicUrl: false,
      ),
    );
    try {
      await _api.putPresigned(
        target.uploadUrl,
        bytes,
        contentType: contentType,
      );
      await _api.post<void>(
        '/assets/${target.assetId}/finalize',
        parser: (_) {},
      );
      return PrivateUploadedAsset(
        assetId: target.assetId,
        assetKey: target.assetKey,
      );
    } catch (_) {
      try {
        await deletePrivateUpload(target.assetId);
      } catch (_) {
        // The bounded server sweep owns cleanup when the network is unavailable.
      }
      rethrow;
    }
  }

  Future<void> deletePrivateUpload(String assetId) =>
      _api.delete<void>('/assets/$assetId', parser: (_) {});
}

class PrivateUploadedAsset {
  const PrivateUploadedAsset({required this.assetId, required this.assetKey});
  final String assetId;
  final String assetKey;
}

class UploadedAsset {
  const UploadedAsset({
    required this.assetId,
    required this.assetKey,
    required this.publicUrl,
  });
  final String assetId;
  final String assetKey;
  final String publicUrl;
}

class PresignedUpload {
  const PresignedUpload({
    required this.assetId,
    required this.uploadUrl,
    required this.assetKey,
    required this.publicUrl,
  });

  final String assetId;
  final String uploadUrl; // PUT target
  final String assetKey; // R2 key to reference afterwards
  final String publicUrl; // URL to store in the composition once uploaded

  factory PresignedUpload.fromJson(
    Map<String, dynamic> json, {
    bool requirePublicUrl = true,
  }) => PresignedUpload(
    assetId: json['assetId'] as String,
    uploadUrl: json['uploadUrl'] as String,
    assetKey: (json['assetKey'] ?? json['key']) as String,
    publicUrl: requirePublicUrl ? json['publicUrl'] as String : '',
  );
}

final assetRepositoryProvider = Provider<AssetRepository>((ref) {
  return AssetRepository(ref.watch(apiClientProvider));
});
