import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';

/// Presigned R2 upload/download URLs (`assets` routes in CONTRACTS.md).
class AssetRepository {
  AssetRepository(this._api);

  final ApiClient _api;

  /// Requests a presigned PUT URL to upload a file (e.g. a gallery image
  /// used to replace a generated scene image, or a brand logo).
  Future<PresignedUpload> getUploadUrl({required String fileName, required String contentType}) {
    return _api.post<PresignedUpload>(
      '/assets/upload-url',
      body: {'fileName': fileName, 'contentType': contentType},
      parser: (json) => PresignedUpload.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<String> getDownloadUrl(String assetKey) {
    return _api.get<String>(
      '/assets/download-url',
      query: {'key': assetKey},
      parser: (json) => (json as Map<String, dynamic>)['url'] as String,
    );
  }
}

class PresignedUpload {
  const PresignedUpload({required this.uploadUrl, required this.assetKey, required this.publicUrl});

  final String uploadUrl; // PUT target
  final String assetKey; // R2 key to reference afterwards
  final String publicUrl; // URL to store in the composition once uploaded

  factory PresignedUpload.fromJson(Map<String, dynamic> json) => PresignedUpload(
        uploadUrl: json['uploadUrl'] as String,
        assetKey: json['assetKey'] as String,
        publicUrl: json['publicUrl'] as String,
      );
}

final assetRepositoryProvider = Provider<AssetRepository>((ref) {
  return AssetRepository(ref.watch(apiClientProvider));
});
