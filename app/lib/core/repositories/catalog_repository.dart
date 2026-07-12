import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../models/catalog.dart';

abstract interface class CatalogRepository {
  Future<List<CatalogCategory>> listCategories();
  Future<List<CatalogTemplate>> listTemplates();
  Future<CatalogTemplate> getTemplate(String slugOrId);
}

class ApiCatalogRepository implements CatalogRepository {
  ApiCatalogRepository(this._api);
  final ApiClient _api;

  @override
  Future<List<CatalogCategory>> listCategories() => _api.get(
    '/catalog/categories',
    parser: (json) => (json as List<dynamic>)
        .whereType<Map<String, dynamic>>()
        .map(CatalogCategory.fromJson)
        .toList(growable: false),
  );

  @override
  Future<List<CatalogTemplate>> listTemplates() => _api.get(
    '/catalog/templates',
    parser: (json) => (json as List<dynamic>)
        .whereType<Map<String, dynamic>>()
        .map(CatalogTemplate.fromJson)
        .toList(growable: false),
  );

  @override
  Future<CatalogTemplate> getTemplate(String slugOrId) => _api.get(
    '/catalog/templates/${Uri.encodeComponent(slugOrId)}',
    parser: (json) => CatalogTemplate.fromJson(json as Map<String, dynamic>),
  );
}

final catalogRepositoryProvider = Provider<CatalogRepository>((ref) {
  return ApiCatalogRepository(ref.watch(apiClientProvider));
});
