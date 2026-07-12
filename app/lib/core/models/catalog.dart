import 'package:flutter/foundation.dart';

enum CatalogInputType {
  shortText,
  longText,
  number,
  boolean,
  select,
  image,
  audio,
  unavailable,
}

@immutable
class CatalogInputOption {
  const CatalogInputOption({required this.value, required this.label});
  final Object value;
  final String label;

  factory CatalogInputOption.fromJson(Map<String, dynamic> json) =>
      CatalogInputOption(
        value: json['value'] as Object,
        label: json['label'] as String,
      );
}

@immutable
class CatalogInputDefinition {
  const CatalogInputDefinition({
    required this.id,
    required this.key,
    required this.type,
    required this.label,
    required this.required,
    required this.order,
    this.helpText,
    this.placeholder,
    this.minLength,
    this.maxLength,
    this.min,
    this.max,
    this.step,
    this.unit,
    this.multiple = false,
    this.options = const [],
    this.defaultValue,
    this.maxBytes,
    this.acceptedContentTypes = const [],
  });

  final String id;
  final String key;
  final CatalogInputType type;
  final String label;
  final bool required;
  final int order;
  final String? helpText;
  final String? placeholder;
  final int? minLength;
  final int? maxLength;
  final double? min;
  final double? max;
  final double? step;
  final String? unit;
  final bool multiple;
  final List<CatalogInputOption> options;
  final bool? defaultValue;
  final int? maxBytes;
  final List<String> acceptedContentTypes;

  bool get isSupported => type != CatalogInputType.unavailable;

  factory CatalogInputDefinition.fromJson(Map<String, dynamic> json) {
    const types = {
      'short_text': CatalogInputType.shortText,
      'long_text': CatalogInputType.longText,
      'number': CatalogInputType.number,
      'boolean': CatalogInputType.boolean,
      'select': CatalogInputType.select,
      'image': CatalogInputType.image,
      'audio': CatalogInputType.audio,
    };
    return CatalogInputDefinition(
      id: json['id']?.toString() ?? '',
      key: json['key']?.toString() ?? '',
      type: types[json['type']] ?? CatalogInputType.unavailable,
      label: json['label']?.toString() ?? 'Unavailable field',
      required: json['required'] == true,
      order: (json['order'] as num?)?.toInt() ?? 0,
      helpText: json['helpText'] as String?,
      placeholder: json['placeholder'] as String?,
      minLength: (json['minLength'] as num?)?.toInt(),
      maxLength: (json['maxLength'] as num?)?.toInt(),
      min: (json['min'] as num?)?.toDouble(),
      max: (json['max'] as num?)?.toDouble(),
      step: (json['step'] as num?)?.toDouble(),
      unit: json['unit'] as String?,
      multiple: json['multiple'] == true,
      options: (json['options'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(CatalogInputOption.fromJson)
          .toList(growable: false),
      defaultValue: json['defaultValue'] as bool?,
      maxBytes: (json['maxBytes'] as num?)?.toInt(),
      acceptedContentTypes:
          (json['acceptedContentTypes'] as List<dynamic>? ?? const [])
              .whereType<String>()
              .toList(growable: false),
    );
  }
}

@immutable
class CatalogTemplate {
  const CatalogTemplate({
    required this.id,
    required this.templateId,
    required this.slug,
    required this.version,
    required this.displayName,
    required this.pipelineType,
    required this.capabilities,
    required this.fields,
    this.description,
    this.previewUrl,
  });
  final String id;
  final String templateId;
  final String slug;
  final int version;
  final String displayName;
  final String? description;
  final String? previewUrl;
  final String pipelineType;
  final Map<String, dynamic> capabilities;
  final List<CatalogInputDefinition> fields;

  factory CatalogTemplate.fromJson(Map<String, dynamic> json) {
    final schema = json['inputSchema'];
    final schemaMap = schema is Map<String, dynamic>
        ? schema
        : const <String, dynamic>{};
    final fields =
        (schemaMap['fields'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(CatalogInputDefinition.fromJson)
            .toList()
          ..sort((a, b) => a.order.compareTo(b.order));
    return CatalogTemplate(
      id: json['id'] as String,
      templateId: json['templateId'] as String,
      slug: json['slug'] as String,
      version: (json['version'] as num).toInt(),
      displayName: json['displayName'] as String,
      description: json['description'] as String?,
      previewUrl: json['previewUrl'] as String?,
      pipelineType: json['pipelineType']?.toString() ?? 'video',
      capabilities: (json['capabilities'] as Map<String, dynamic>?) ?? const {},
      fields: List.unmodifiable(fields),
    );
  }
}

@immutable
class CatalogCategory {
  const CatalogCategory({
    required this.id,
    required this.slug,
    required this.name,
    required this.order,
    required this.templates,
    this.description,
    this.coverUrl,
  });
  final String id;
  final String slug;
  final String name;
  final String? description;
  final String? coverUrl;
  final int order;
  final List<CatalogTemplate> templates;

  factory CatalogCategory.fromJson(Map<String, dynamic> json) =>
      CatalogCategory(
        id: json['id'] as String,
        slug: json['slug'] as String,
        name: json['name'] as String,
        description: json['description'] as String?,
        coverUrl: json['coverUrl'] as String?,
        order: (json['order'] as num?)?.toInt() ?? 0,
        templates: (json['templates'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(CatalogTemplate.fromJson)
            .toList(growable: false),
      );
}
