import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/catalog.dart';
import '../../../core/repositories/asset_repository.dart';
import '../../../design_system/components/section_card.dart';
import '../../../design_system/tokens/app_spacing.dart';

class MediaAssetField extends ConsumerStatefulWidget {
  const MediaAssetField({
    super.key,
    required this.definition,
    required this.onChanged,
  });

  final CatalogInputDefinition definition;
  final ValueChanged<String?> onChanged;

  @override
  ConsumerState<MediaAssetField> createState() => _MediaAssetFieldState();
}

class _MediaAssetFieldState extends ConsumerState<MediaAssetField> {
  String? _url;
  String? _fileName;
  String? _error;
  bool _uploading = false;

  bool get _isImage => widget.definition.type == CatalogInputType.image;

  @override
  Widget build(BuildContext context) {
    return FormField<String>(
      initialValue: _url,
      validator: (_) => widget.definition.required && _url == null
          ? 'Add ${widget.definition.label.toLowerCase()}'
          : null,
      builder: (field) => SectionCard(
        padding: const EdgeInsets.all(AppSpacing.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  _isImage
                      ? Icons.add_photo_alternate_outlined
                      : Icons.audio_file_outlined,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.definition.required
                            ? '${widget.definition.label} *'
                            : widget.definition.label,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      Text(
                        _fileName ??
                            widget.definition.helpText ??
                            'Optional creative reference',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                if (_url != null)
                  IconButton(
                    tooltip: 'Remove selected file',
                    onPressed: () {
                      setState(() {
                        _url = null;
                        _fileName = null;
                        _error = null;
                      });
                      field.didChange(null);
                      widget.onChanged(null);
                    },
                    icon: const Icon(Icons.close_rounded),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            OutlinedButton.icon(
              onPressed: _uploading ? null : () => _pickAndUpload(field),
              icon: _uploading
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(
                      _url == null ? Icons.upload_rounded : Icons.swap_horiz,
                    ),
              label: Text(
                _uploading
                    ? 'Uploading securely'
                    : _url == null
                    ? 'Choose ${_isImage ? 'image' : 'audio'}'
                    : 'Replace file',
              ),
            ),
            if (_error != null || field.errorText != null) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(
                _error ?? field.errorText!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.error,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _pickAndUpload(FormFieldState<String> field) async {
    final extensions = widget.definition.acceptedContentTypes
        .map(_extensionFor)
        .whereType<String>()
        .toSet()
        .toList(growable: false);
    final result = await FilePicker.platform.pickFiles(
      type: extensions.isEmpty ? FileType.any : FileType.custom,
      allowedExtensions: extensions.isEmpty ? null : extensions,
      allowMultiple: false,
      withData: true,
    );
    final file = result?.files.singleOrNull;
    if (file == null) return;
    final bytes = file.bytes;
    if (bytes == null) {
      setState(() => _error = 'This file could not be read on your device.');
      return;
    }
    final maxBytes = widget.definition.maxBytes;
    if (maxBytes != null && bytes.length > maxBytes) {
      setState(
        () => _error =
            'Choose a file smaller than ${(maxBytes / 1000000).floor()} MB.',
      );
      return;
    }
    final contentType = _contentTypeFor(file.extension);
    if (contentType == null ||
        (widget.definition.acceptedContentTypes.isNotEmpty &&
            !widget.definition.acceptedContentTypes.contains(contentType))) {
      setState(() => _error = 'Choose a supported file format.');
      return;
    }
    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      final uploaded = await ref
          .read(assetRepositoryProvider)
          .uploadBytes(
            kind: _isImage ? 'image' : 'audio',
            contentType: contentType,
            bytes: bytes,
          );
      if (!mounted) return;
      setState(() {
        _url = uploaded.publicUrl;
        _fileName = file.name;
      });
      field.didChange(uploaded.publicUrl);
      widget.onChanged(uploaded.publicUrl);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Upload did not finish. Your file stayed private; try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  String? _extensionFor(String contentType) => switch (contentType) {
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
    'audio/flac' => 'flac',
    'audio/mpeg' => 'mp3',
    'audio/wav' || 'audio/x-wav' => 'wav',
    _ => null,
  };

  String? _contentTypeFor(String? extension) =>
      switch (extension?.toLowerCase()) {
        'jpg' || 'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'webp' => 'image/webp',
        'flac' => 'audio/flac',
        'mp3' => 'audio/mpeg',
        'wav' => 'audio/wav',
        _ => null,
      };
}
