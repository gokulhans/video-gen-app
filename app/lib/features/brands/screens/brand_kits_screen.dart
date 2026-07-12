import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../../core/models/brand.dart';
import '../../../core/models/composition.dart';
import '../../../core/repositories/brand_repository.dart';
import '../../../core/repositories/asset_repository.dart';
import '../../../design_system/tokens/app_breakpoints.dart';
import '../../../design_system/tokens/app_spacing.dart';

final brandKitsProvider = FutureProvider.autoDispose<List<Brand>>(
  (ref) => ref.watch(brandRepositoryProvider).listBrands(),
);

class BrandKitsScreen extends ConsumerStatefulWidget {
  const BrandKitsScreen({super.key});
  @override
  ConsumerState<BrandKitsScreen> createState() => _BrandKitsScreenState();
}

class _BrandKitsScreenState extends ConsumerState<BrandKitsScreen> {
  bool _saving = false;
  Future<void> Function()? _pendingRetry;

  @override
  Widget build(BuildContext context) {
    final brands = ref.watch(brandKitsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Brand kits')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _saving ? null : () => _showEditor(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('New kit'),
      ),
      body: brands.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(child: Text('$error')),
        data: (items) => LayoutBuilder(
          builder: (context, constraints) {
            if (items.isEmpty) {
              return const Center(
                child: Text('Create a reusable identity for every video.'),
              );
            }
            final columns =
                constraints.maxWidth >= AppBreakpoints.contentMaxWidth
                ? 3
                : constraints.maxWidth >= AppBreakpoints.navigationRail
                ? 2
                : 1;
            return GridView.builder(
              padding: const EdgeInsets.all(AppSpacing.md),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                crossAxisSpacing: AppSpacing.md,
                mainAxisSpacing: AppSpacing.md,
                mainAxisExtent: MediaQuery.textScalerOf(context).scale(190),
              ),
              itemCount: items.length,
              itemBuilder: (context, index) => _BrandCard(
                brand: items[index],
                onEdit: () {
                  if (!_saving) _showEditor(context, ref, items[index]);
                },
                onArchive: () async {
                  await ref
                      .read(brandRepositoryProvider)
                      .archiveBrand(items[index].id);
                  ref.invalidate(brandKitsProvider);
                },
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _showEditor(
    BuildContext context,
    WidgetRef ref, [
    Brand? brand,
  ]) async {
    final name = TextEditingController(text: brand?.name);
    final primary = TextEditingController(
      text: brand?.primaryColor ?? '#6750A4',
    );
    final secondary = TextEditingController(
      text: brand?.secondaryColor ?? '#625B71',
    );
    final font = TextEditingController(text: brand?.font);
    final website = TextEditingController(text: brand?.website);
    final phone = TextEditingController(text: brand?.phone);
    var watermark = brand?.watermark ?? true;
    var position = brand?.logoPosition ?? LogoPosition.topRight;
    List<int>? logoBytes;
    String? contentType;
    final save = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(brand == null ? 'New brand kit' : 'Edit brand kit'),
          content: SizedBox(
            width: 480,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: name,
                    decoration: const InputDecoration(labelText: 'Brand name'),
                  ),
                  TextField(
                    controller: primary,
                    decoration: const InputDecoration(
                      labelText: 'Primary #RRGGBB',
                    ),
                  ),
                  TextField(
                    controller: secondary,
                    decoration: const InputDecoration(
                      labelText: 'Secondary #RRGGBB',
                    ),
                  ),
                  TextField(
                    controller: font,
                    decoration: const InputDecoration(labelText: 'Font'),
                  ),
                  TextField(
                    controller: website,
                    decoration: const InputDecoration(labelText: 'Website URL'),
                  ),
                  TextField(
                    controller: phone,
                    decoration: const InputDecoration(labelText: 'Phone'),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Watermark'),
                    value: watermark,
                    onChanged: (value) =>
                        setDialogState(() => watermark = value),
                  ),
                  DropdownButtonFormField<LogoPosition>(
                    initialValue: position,
                    decoration: const InputDecoration(
                      labelText: 'Logo position',
                    ),
                    items: LogoPosition.values
                        .map(
                          (value) => DropdownMenuItem(
                            value: value,
                            child: Text(value.wireValue),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value != null) setDialogState(() => position = value);
                    },
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  if (logoBytes != null)
                    Semantics(
                      label: 'Selected brand logo preview',
                      child: Image.memory(
                        Uint8List.fromList(logoBytes!),
                        height: 96,
                        fit: BoxFit.contain,
                      ),
                    ),
                  OutlinedButton.icon(
                    onPressed: () async {
                      final result = await FilePicker.platform.pickFiles(
                        type: FileType.custom,
                        allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp'],
                        withData: true,
                      );
                      final file = result?.files.singleOrNull;
                      if (file?.bytes != null)
                        setDialogState(() {
                          logoBytes = file!.bytes;
                          contentType = file.extension?.toLowerCase() == 'png'
                              ? 'image/png'
                              : file.extension?.toLowerCase() == 'webp'
                              ? 'image/webp'
                              : 'image/jpeg';
                        });
                    },
                    icon: const Icon(Icons.image_outlined),
                    label: Text(
                      logoBytes == null ? 'Choose logo' : 'Change logo',
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    final hex = RegExp(r'^#[0-9A-Fa-f]{6}$');
    if (save != true) return;
    if (name.text.trim().isEmpty ||
        !hex.hasMatch(primary.text) ||
        !hex.hasMatch(secondary.text) ||
        (website.text.trim().isNotEmpty &&
            Uri.tryParse(website.text.trim())?.hasAbsolutePath != true)) {
      if (context.mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Enter a name, valid hex colors, and a full website URL.',
            ),
          ),
        );
      return;
    }
    final value = Brand(
      id: brand?.id ?? '',
      name: name.text.trim(),
      logoUrl: brand?.logoUrl,
      primaryColor: primary.text,
      secondaryColor: secondary.text,
      font: font.text.trim().isEmpty ? null : font.text.trim(),
      phone: phone.text.trim().isEmpty ? null : phone.text.trim(),
      website: website.text.trim().isEmpty ? null : website.text.trim(),
      watermark: watermark,
      logoPosition: position,
    );
    String? assetId;
    try {
      setState(() {
        _saving = true;
        _pendingRetry = null;
      });
      if (logoBytes != null) {
        final upload = await ref
            .read(assetRepositoryProvider)
            .uploadPrivateBytes(
              kind: 'image',
              contentType: contentType!,
              bytes: logoBytes!,
              purpose: 'brand_logo',
            );
        assetId = upload.assetId;
      }
      final idempotencyKey = const Uuid().v4();
      final repository = ref.read(brandRepositoryProvider);
      if (brand == null) {
        _pendingRetry = () => repository.createBrand(
          value,
          logoAssetId: assetId,
          idempotencyKey: idempotencyKey,
        );
      } else {
        _pendingRetry = () => repository.updateBrand(
          brand.id,
          value,
          logoAssetId: assetId,
          idempotencyKey: idempotencyKey,
        );
      }
      await _pendingRetry!();
      _pendingRetry = null;
    } catch (error) {
      // The mutation may have committed before a response was lost. Its stable
      // idempotency key and the server cleanup outbox own reconciliation.
      if (context.mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Brand kit save was not confirmed: $error'),
            action: _pendingRetry == null
                ? null
                : SnackBarAction(label: 'Retry safely', onPressed: _retrySave),
          ),
        );
      return;
    } finally {
      if (mounted) setState(() => _saving = false);
    }
    ref.invalidate(brandKitsProvider);
  }

  Future<void> _retrySave() async {
    final retry = _pendingRetry;
    if (retry == null || _saving) return;
    setState(() => _saving = true);
    try {
      await retry();
      _pendingRetry = null;
      ref.invalidate(brandKitsProvider);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Brand kit save is still unconfirmed: $error'),
            action: SnackBarAction(
              label: 'Retry safely',
              onPressed: _retrySave,
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _BrandCard extends StatelessWidget {
  const _BrandCard({
    required this.brand,
    required this.onEdit,
    required this.onArchive,
  });
  final Brand brand;
  final VoidCallback onEdit;
  final VoidCallback onArchive;
  Color _parse(String? value, Color fallback) {
    if (value == null || !RegExp(r'^#[0-9A-Fa-f]{6}$').hasMatch(value))
      return fallback;
    return Color(int.parse(value.substring(1), radix: 16) + 0xFF000000);
  }

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (brand.logoUrl != null) ...[
            Semantics(
              label: '${brand.name} saved logo',
              image: true,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.network(
                  brand.logoUrl!,
                  height: 52,
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => const SizedBox(
                    height: 52,
                    child: Center(child: Icon(Icons.broken_image_outlined)),
                  ),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          Row(
            children: [
              Expanded(
                child: Text(
                  brand.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              PopupMenuButton<String>(
                onSelected: (value) => value == 'edit' ? onEdit() : onArchive(),
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'edit', child: Text('Edit')),
                  PopupMenuItem(value: 'archive', child: Text('Archive')),
                ],
              ),
            ],
          ),
          Text(
            'Version ${brand.version}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const Spacer(),
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Row(
              children: [
                Expanded(
                  child: ColoredBox(
                    color: _parse(
                      brand.primaryColor,
                      Theme.of(context).colorScheme.primary,
                    ),
                    child: const SizedBox(height: 44),
                  ),
                ),
                Expanded(
                  child: ColoredBox(
                    color: _parse(
                      brand.secondaryColor,
                      Theme.of(context).colorScheme.secondary,
                    ),
                    child: const SizedBox(height: 44),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}
