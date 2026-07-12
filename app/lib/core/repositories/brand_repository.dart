import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../models/brand.dart';

/// `brands` CRUD, per CONTRACTS.md ("brands CRUD").
class BrandRepository {
  BrandRepository(this._api);

  final ApiClient _api;

  Future<List<Brand>> listBrands() {
    return _api.get<List<Brand>>(
      '/brands',
      parser: (json) => (json as List<dynamic>)
          .map((e) => Brand.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<Brand> createBrand(Brand brand) {
    return _api.post<Brand>(
      '/brands',
      body: brand.toJson(),
      parser: (json) => Brand.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<Brand> updateBrand(String id, Brand brand) {
    return _api.patch<Brand>(
      '/brands/$id',
      body: brand.toJson(),
      parser: (json) => Brand.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<void> deleteBrand(String id) {
    return _api.delete<void>('/brands/$id');
  }
}

final brandRepositoryProvider = Provider<BrandRepository>((ref) {
  return BrandRepository(ref.watch(apiClientProvider));
});
