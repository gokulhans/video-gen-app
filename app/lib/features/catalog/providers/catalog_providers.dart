import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/catalog.dart';
import '../../../core/repositories/catalog_repository.dart';

final catalogCategoriesProvider =
    FutureProvider.autoDispose<List<CatalogCategory>>((ref) async {
      final categories = await ref
          .watch(catalogRepositoryProvider)
          .listCategories();
      return categories
          .where((category) => category.templates.isNotEmpty)
          .toList(growable: false)
        ..sort((a, b) => a.order.compareTo(b.order));
    });

final catalogTemplateProvider = FutureProvider.autoDispose
    .family<CatalogTemplate, String>((ref, slugOrId) {
      return ref.watch(catalogRepositoryProvider).getTemplate(slugOrId);
    });
