import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../models/brand.dart';

class BrandRepository {
  BrandRepository(this._api);
  final ApiClient _api;

  Future<List<Brand>> listBrands({bool includeArchived = false}) =>
      _api.get<List<Brand>>(
        '/brands',
        query: {'includeArchived': includeArchived},
        parser: (json) => (json as List<dynamic>)
            .map((item) => Brand.fromJson(item as Map<String, dynamic>))
            .toList(),
      );

  Future<Brand> createBrand(
    Brand brand, {
    String? logoAssetId,
    required String idempotencyKey,
  }) async {
    Future<Brand> request() => _api.post<Brand>(
      '/brands',
      headers: {'Idempotency-Key': idempotencyKey},
      body: {
        ...brand.toJson(),
        if (logoAssetId != null) 'logoAssetId': logoAssetId,
      },
      parser: (json) => Brand.fromJson(json as Map<String, dynamic>),
    );
    try {
      return await request();
    } catch (_) {
      return request();
    }
  }

  Future<Brand> updateBrand(
    String id,
    Brand brand, {
    String? logoAssetId,
    required String idempotencyKey,
  }) async {
    Future<Brand> request() => _api.patch<Brand>(
      '/brands/$id',
      headers: {'Idempotency-Key': idempotencyKey},
      body: {
        ...brand.toJson(),
        if (logoAssetId != null) 'logoAssetId': logoAssetId,
      },
      parser: (json) => Brand.fromJson(json as Map<String, dynamic>),
    );
    try {
      return await request();
    } catch (_) {
      return request();
    }
  }

  Future<void> archiveBrand(String id) =>
      _api.post<void>('/brands/$id/archive', parser: (_) {});

  Future<void> deleteBrand(String id) => archiveBrand(id);
}

final brandRepositoryProvider = Provider<BrandRepository>(
  (ref) => BrandRepository(ref.watch(apiClientProvider)),
);
