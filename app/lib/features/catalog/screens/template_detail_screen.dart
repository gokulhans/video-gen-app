import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/models/catalog.dart';
import '../../../core/models/generation.dart';
import '../../../design_system/components/app_page.dart';
import '../../../design_system/components/error_state.dart';
import '../../../design_system/components/media_preview_tile.dart';
import '../../../design_system/components/primary_action_button.dart';
import '../../../design_system/components/section_card.dart';
import '../../../design_system/components/skeleton_box.dart';
import '../../../design_system/components/status_badge.dart';
import '../../../design_system/tokens/app_spacing.dart';
import '../../create/providers/generation_providers.dart';
import '../providers/catalog_providers.dart';
import '../widgets/media_asset_field.dart';

class TemplateDetailScreen extends ConsumerStatefulWidget {
  const TemplateDetailScreen({super.key, required this.slugOrId});
  final String slugOrId;
  @override
  ConsumerState<TemplateDetailScreen> createState() =>
      _TemplateDetailScreenState();
}

class _TemplateDetailScreenState extends ConsumerState<TemplateDetailScreen> {
  final _formKey = GlobalKey<FormState>();
  final Map<String, TextEditingController> _text = {};
  final Map<String, dynamic> _values = {};

  @override
  void dispose() {
    for (final controller in _text.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final templateAsync = ref.watch(catalogTemplateProvider(widget.slugOrId));
    final submission = ref.watch(generationSubmissionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Create video')),
      body: AppPage(
        child: templateAsync.when(
          loading: () => const _DetailSkeleton(),
          error: (_, _) => ErrorState(
            message: 'This format is unavailable right now.',
            onRetry: () =>
                ref.invalidate(catalogTemplateProvider(widget.slugOrId)),
          ),
          data: (template) => Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
              children: [
                _TemplateHero(template: template),
                const SizedBox(height: AppSpacing.xl),
                Text(
                  'Make it yours',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  'Only the details this format needs. Your final price is confirmed before generation.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                SectionCard(
                  child: Column(
                    children: [
                      for (final field in template.fields) ...[
                        _field(field),
                        if (field != template.fields.last)
                          const SizedBox(height: AppSpacing.lg),
                      ],
                    ],
                  ),
                ),
                if (submission.errorMessage != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    submission.errorMessage!,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
                const SizedBox(height: AppSpacing.lg),
                if (submission.quote == null)
                  PrimaryActionButton(
                    label: 'Get exact price',
                    icon: Icons.bolt_rounded,
                    style: PrimaryActionStyle.generation,
                    isLoading: submission.isQuoting,
                    onPressed: submission.isQuoting
                        ? null
                        : () => _quote(template),
                  )
                else
                  _QuoteConfirmation(
                    quote: submission.quote!,
                    isSubmitting: submission.isSubmitting,
                    onConfirm: _submit,
                    onEdit: () => ref.invalidate(generationSubmissionProvider),
                  ),
                const SizedBox(height: AppSpacing.xxl),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _field(CatalogInputDefinition field) {
    if (!field.isSupported) return _UnavailableField(label: field.label);
    switch (field.type) {
      case CatalogInputType.shortText:
      case CatalogInputType.longText:
        final controller = _text.putIfAbsent(
          field.key,
          TextEditingController.new,
        );
        return TextFormField(
          controller: controller,
          maxLines: field.type == CatalogInputType.longText ? 5 : 1,
          minLines: field.type == CatalogInputType.longText ? 3 : 1,
          maxLength: field.maxLength,
          decoration: InputDecoration(
            labelText: field.required ? '${field.label} *' : field.label,
            hintText: field.placeholder,
            helperText: field.helpText,
          ),
          validator: (value) {
            final length = value?.trim().length ?? 0;
            if (field.required && length == 0) {
              return '${field.label} is required';
            }
            if (field.minLength != null && length < field.minLength!) {
              return 'Use at least ${field.minLength} characters';
            }
            return null;
          },
        );
      case CatalogInputType.number:
        final controller = _text.putIfAbsent(
          field.key,
          TextEditingController.new,
        );
        return TextFormField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: field.required ? '${field.label} *' : field.label,
            helperText: field.helpText,
            suffixText: field.unit,
          ),
          validator: (value) {
            final number = double.tryParse(value ?? '');
            if (field.required && number == null) return 'Enter a number';
            if (number != null && field.min != null && number < field.min!) {
              return 'Minimum ${field.min}';
            }
            if (number != null && field.max != null && number > field.max!) {
              return 'Maximum ${field.max}';
            }
            return null;
          },
        );
      case CatalogInputType.boolean:
        _values.putIfAbsent(field.key, () => field.defaultValue ?? false);
        return SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          title: Text(field.label),
          subtitle: field.helpText == null ? null : Text(field.helpText!),
          value: _values[field.key] as bool,
          onChanged: (value) => setState(() => _values[field.key] = value),
        );
      case CatalogInputType.select:
        return DropdownButtonFormField<Object>(
          initialValue: _values[field.key],
          decoration: InputDecoration(
            labelText: field.required ? '${field.label} *' : field.label,
            helperText: field.helpText,
          ),
          items: [
            for (final option in field.options)
              DropdownMenuItem(value: option.value, child: Text(option.label)),
          ],
          onChanged: (value) => setState(() => _values[field.key] = value),
          validator: (value) => field.required && value == null
              ? 'Choose ${field.label.toLowerCase()}'
              : null,
        );
      case CatalogInputType.image:
      case CatalogInputType.audio:
        return MediaAssetField(
          definition: field,
          onChanged: (value) {
            if (value == null) {
              _values.remove(field.key);
            } else {
              _values[field.key] = value;
            }
          },
        );
      case CatalogInputType.unavailable:
        return _UnavailableField(label: field.label, required: field.required);
    }
  }

  Future<void> _quote(CatalogTemplate template) async {
    if (!_formKey.currentState!.validate()) return;
    final inputs = <String, dynamic>{..._values};
    for (final field in template.fields) {
      final raw = _text[field.key]?.text.trim();
      if (raw == null || raw.isEmpty) continue;
      inputs[field.key] = field.type == CatalogInputType.number
          ? double.parse(raw)
          : raw;
    }
    await ref
        .read(generationSubmissionProvider.notifier)
        .requestQuote(
          GenerationSelection(templateVersionId: template.id, inputs: inputs),
        );
  }

  Future<void> _submit() async {
    final job = await ref
        .read(generationSubmissionProvider.notifier)
        .submitQuotedJob();
    if (job != null && mounted) context.go('/generation/${job.id}');
  }
}

class _TemplateHero extends StatelessWidget {
  const _TemplateHero({required this.template});
  final CatalogTemplate template;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final wide = constraints.maxWidth >= 700;
      final media = ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: template.previewUrl == null
            ? const MediaPreviewTile(
                kind: MediaPreviewKind.video,
                selected: true,
                aspectRatio: 16 / 9,
              )
            : AspectRatio(
                aspectRatio: 16 / 9,
                child: CachedNetworkImage(
                  imageUrl: template.previewUrl!,
                  fit: BoxFit.cover,
                  errorWidget: (context, url, error) =>
                      const MediaPreviewTile(kind: MediaPreviewKind.video),
                ),
              ),
      );
      final copy = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const StatusBadge(
            label: 'Published format',
            status: AppStatus.success,
            icon: Icons.verified_rounded,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            template.displayName,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            template.description ??
                'A flexible AI video format ready for your business.',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Production-ready format',
            style: Theme.of(context).textTheme.labelMedium,
          ),
          if (_capabilityLabels(template).isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.xs,
              runSpacing: AppSpacing.xs,
              children: [
                for (final label in _capabilityLabels(template))
                  StatusBadge(label: label, status: AppStatus.info),
              ],
            ),
          ],
        ],
      );
      return wide
          ? Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(child: media),
                const SizedBox(width: AppSpacing.xl),
                Expanded(child: copy),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                media,
                const SizedBox(height: AppSpacing.lg),
                copy,
              ],
            );
    },
  );
}

class _QuoteConfirmation extends StatelessWidget {
  const _QuoteConfirmation({
    required this.quote,
    required this.isSubmitting,
    required this.onConfirm,
    required this.onEdit,
  });
  final GenerationQuote quote;
  final bool isSubmitting;
  final VoidCallback onConfirm;
  final VoidCallback onEdit;
  @override
  Widget build(BuildContext context) => SectionCard(
    raised: true,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Your exact price',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    '${quote.estimatedMinSec}–${quote.estimatedMaxSec} sec estimated production',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            Text(
              '${quote.creditAmount} credits',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        PrimaryActionButton(
          label: 'Confirm & generate',
          icon: Icons.auto_awesome_rounded,
          style: PrimaryActionStyle.generation,
          isLoading: isSubmitting,
          onPressed: isSubmitting ? null : onConfirm,
        ),
        TextButton(
          onPressed: isSubmitting ? null : onEdit,
          child: const Text('Edit details and re-price'),
        ),
      ],
    ),
  );
}

class _UnavailableField extends StatelessWidget {
  const _UnavailableField({required this.label, this.required = false});
  final String label;
  final bool required;
  @override
  Widget build(BuildContext context) => FormField<void>(
    validator: (_) => required ? '$label requires a newer app version' : null,
    builder: (field) => Semantics(
      label: '$label unavailable',
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Theme.of(
            context,
          ).colorScheme.errorContainer.withValues(alpha: .35),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.lock_outline_rounded,
                color: Theme.of(context).colorScheme.error,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: Theme.of(context).textTheme.titleSmall),
                    const SizedBox(height: AppSpacing.xxs),
                    Text(
                      'This field type needs a newer app version and cannot be used safely.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

List<String> _capabilityLabels(CatalogTemplate template) {
  final capabilities = template.capabilities;
  final labels = <String>[];
  void addValues(String key, String suffix) {
    final value = capabilities[key];
    if (value is List) {
      labels.addAll(value.take(3).map((item) => '$item$suffix'));
    } else if (value is String || value is num) {
      labels.add('$value$suffix');
    }
  }

  addValues('durations', ' sec');
  addValues('durationSec', ' sec');
  addValues('aspectRatios', '');
  addValues('resolutions', '');
  if (capabilities['draft'] == true || capabilities['qualityTier'] == 'draft') {
    labels.add('Fast draft');
  }
  return labels.take(5).toList(growable: false);
}

class _DetailSkeleton extends StatelessWidget {
  const _DetailSkeleton();
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
    children: const [
      SkeletonBox(height: 260),
      SizedBox(height: AppSpacing.xl),
      SkeletonBox(height: 30, width: 180),
      SizedBox(height: AppSpacing.md),
      SkeletonBox(height: 220),
    ],
  );
}
