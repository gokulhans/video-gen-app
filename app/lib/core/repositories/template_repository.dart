import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../models/template.dart';

/// `GET /templates` (KV-cached on the server) and the curated voice list.
class TemplateRepository {
  TemplateRepository(this._api);

  final ApiClient _api;

  Future<List<VideoTemplate>> listTemplates({String? vertical}) {
    return _api.get<List<VideoTemplate>>(
      '/templates',
      query: vertical != null ? {'vertical': vertical} : null,
      parser: (json) => (json as List<dynamic>)
          .map((e) => VideoTemplate.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<List<VoiceOption>> listVoices({String? language}) {
    return _api.get<List<VoiceOption>>(
      '/voices',
      query: language != null ? {'language': language} : null,
      parser: (json) =>
          (json as List<dynamic>).map((e) => VoiceOption.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }
}

final templateRepositoryProvider = Provider<TemplateRepository>((ref) {
  return TemplateRepository(ref.watch(apiClientProvider));
});
