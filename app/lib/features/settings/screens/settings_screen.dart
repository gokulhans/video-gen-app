import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:uuid/uuid.dart';
import '../../../core/models/account_settings.dart';
import '../../../core/repositories/account_settings_repository.dart';
import '../../../design_system/tokens/app_breakpoints.dart';
import '../../../design_system/tokens/app_spacing.dart';

final settingsPreferencesProvider = FutureProvider.autoDispose(
  (ref) => ref.watch(accountSettingsRepositoryProvider).preferences(),
);
final consentSummaryProvider = FutureProvider.autoDispose(
  (ref) => ref.watch(accountSettingsRepositoryProvider).consentSummary(),
);
final exportRequestsProvider = FutureProvider.autoDispose(
  (ref) => ref.watch(accountSettingsRepositoryProvider).exportRequests(),
);
final deletionRequestsProvider = FutureProvider.autoDispose(
  (ref) => ref.watch(accountSettingsRepositoryProvider).deletionRequests(),
);

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
    appBar: AppBar(title: const Text('Settings')),
    body: LayoutBuilder(
      builder: (context, constraints) {
        final panels = <Widget>[
          _NotificationSettings(value: ref.watch(settingsPreferencesProvider)),
          _PrivacySettings(value: ref.watch(consentSummaryProvider)),
        ];
        final wide = constraints.maxWidth >= AppBreakpoints.navigationRail;
        return SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: AppBreakpoints.contentMaxWidth,
              ),
              child: wide
                  ? Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: panels
                          .map(
                            (panel) => Expanded(
                              child: Padding(
                                padding: const EdgeInsets.all(AppSpacing.xs),
                                child: panel,
                              ),
                            ),
                          )
                          .toList(),
                    )
                  : Column(
                      children: panels
                          .map(
                            (panel) => Padding(
                              padding: const EdgeInsets.only(
                                bottom: AppSpacing.md,
                              ),
                              child: panel,
                            ),
                          )
                          .toList(),
                    ),
            ),
          ),
        );
      },
    ),
  );
}

class _NotificationSettings extends ConsumerStatefulWidget {
  const _NotificationSettings({required this.value});
  final AsyncValue<NotificationPreferences> value;
  @override
  ConsumerState<_NotificationSettings> createState() =>
      _NotificationSettingsState();
}

class _NotificationSettingsState extends ConsumerState<_NotificationSettings> {
  NotificationPreferences? _local;
  NotificationPreferences? _confirmed;
  NotificationPreferences? _queued;
  bool _saving = false;

  @override
  void didUpdateWidget(covariant _NotificationSettings oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_saving && widget.value.hasValue) {
      _local = widget.value.value;
      _confirmed = widget.value.value;
    }
  }

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: widget.value.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Text('$error'),
        data: (serverPrefs) {
          _local ??= serverPrefs;
          _confirmed ??= serverPrefs;
          final prefs = _local!;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Notifications',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const Text('Choose channels and important workflow updates.'),
              _tile(
                'Push notifications',
                prefs.pushEnabled,
                (value) => _change(prefs.copyWith(pushEnabled: value)),
              ),
              _tile(
                'Transactional email',
                prefs.emailEnabled,
                (value) => _change(prefs.copyWith(emailEnabled: value)),
              ),
              _tile(
                'Generation updates',
                prefs.generationUpdates,
                (value) => _change(prefs.copyWith(generationUpdates: value)),
              ),
              _tile(
                'Render updates',
                prefs.renderUpdates,
                (value) => _change(prefs.copyWith(renderUpdates: value)),
              ),
              const Text(
                'Email is used only for opted-in generation, render, and account lifecycle updates.',
              ),
              if (_saving) const LinearProgressIndicator(),
            ],
          );
        },
      ),
    ),
  );
  Widget _tile(String title, bool value, ValueChanged<bool> changed) =>
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(title),
        value: value,
        onChanged: changed,
      );
  void _change(NotificationPreferences value) {
    setState(() {
      _local = value;
      _queued = value;
    });
    if (!_saving) _drainWrites();
  }

  Future<void> _drainWrites() async {
    _saving = true;
    if (mounted) setState(() {});
    while (_queued != null) {
      final next = _queued!;
      _queued = null;
      try {
        final saved = await ref
            .read(accountSettingsRepositoryProvider)
            .save(next);
        _confirmed = saved;
      } catch (error) {
        _queued = null;
        if (mounted) {
          setState(() => _local = _confirmed);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Notification settings were not saved: $error'),
            ),
          );
        }
        break;
      }
    }
    _saving = false;
    if (mounted) setState(() {});
  }
}

class _PrivacySettings extends ConsumerStatefulWidget {
  const _PrivacySettings({required this.value});
  final AsyncValue<Map<String, dynamic>> value;
  @override
  ConsumerState<_PrivacySettings> createState() => _PrivacySettingsState();
}

class _PrivacySettingsState extends ConsumerState<_PrivacySettings> {
  String? _exportKey;
  String? _deletionKey;
  bool _exporting = false;
  bool _deleting = false;
  String? _downloadingRequestId;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Privacy & account',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: AppSpacing.sm),
          widget.value.when(
            loading: () => const LinearProgressIndicator(),
            error: (error, _) => Text('$error'),
            data: (summary) => Text(
              '${summary['characterConsentRecords'] ?? 0} immutable presenter consent record(s). Marketing is opt-in.',
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          OutlinedButton.icon(
            onPressed: _exporting ? null : () => _export(context, ref),
            icon: const Icon(Icons.download_outlined),
            label: const Text('Request my data export'),
          ),
          ref
              .watch(exportRequestsProvider)
              .when(
                loading: () => const LinearProgressIndicator(),
                error: (error, _) => Text('Export status unavailable: $error'),
                data: (requests) => Column(
                  children: requests
                      .map(
                        (request) => ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            'Export: ${request['status'] ?? 'unknown'}',
                          ),
                          subtitle: request['expiresAt'] == null
                              ? null
                              : Text(
                                  'Expires ${DateTime.fromMillisecondsSinceEpoch((request['expiresAt'] as num).toInt())}',
                                ),
                          trailing: request['downloadUrl'] is String
                              ? TextButton(
                                  onPressed:
                                      _downloadingRequestId == request['id']
                                      ? null
                                      : () => _downloadExport(context, request),
                                  child: Text(
                                    _downloadingRequestId == request['id']
                                        ? 'Downloading…'
                                        : 'Download',
                                  ),
                                )
                              : null,
                        ),
                      )
                      .toList(),
                ),
              ),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton.icon(
            onPressed: _deleting ? null : () => _delete(context, ref),
            icon: const Icon(Icons.person_remove_outlined),
            label: const Text('Request account deletion'),
          ),
          const Text(
            'After requesting deletion, sign out and sign back in to create a fresh session. Return here within 15 minutes to confirm. You can cancel until the 7-day cooling-off period ends.',
          ),
          ref
              .watch(deletionRequestsProvider)
              .when(
                loading: () => const LinearProgressIndicator(),
                error: (error, _) =>
                    Text('Deletion status unavailable: $error'),
                data: (requests) => Column(
                  children: requests.map((request) {
                    final id = request['id'] as String,
                        status = request['status'] as String? ?? 'unknown';
                    final scheduled = request['scheduledFor'] as num?;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text('Deletion: $status'),
                      subtitle: scheduled == null
                          ? null
                          : Text(
                              'Scheduled for ${DateTime.fromMillisecondsSinceEpoch(scheduled.toInt())}',
                            ),
                      trailing: Wrap(
                        children: [
                          if (status == 'awaiting_reauthentication')
                            TextButton(
                              onPressed: () => _confirm(context, ref, id),
                              child: const Text('Confirm after sign-in'),
                            ),
                          if (status == 'awaiting_reauthentication' ||
                              status == 'scheduled')
                            TextButton(
                              onPressed: () => _cancel(context, ref, id),
                              child: const Text('Cancel'),
                            ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
              ),
        ],
      ),
    ),
  );
  Future<void> _export(BuildContext context, WidgetRef ref) async {
    setState(() {
      _exporting = true;
      _exportKey ??= const Uuid().v4();
    });
    try {
      final result = await ref
          .read(accountSettingsRepositoryProvider)
          .requestExport(_exportKey!);
      _exportKey = null;
      ref.invalidate(exportRequestsProvider);
      if (context.mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Export ${((result['request'] as Map?)?['status'] ?? 'queued')}. You will be notified when ready.',
            ),
          ),
        );
    } catch (error) {
      if (context.mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Export request failed: $error')),
        );
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Request account deletion?'),
        content: const Text(
          'Nothing is deleted now. Re-authentication and a cooling-off period are required.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      setState(() {
        _deleting = true;
        _deletionKey ??= const Uuid().v4();
      });
      try {
        await ref
            .read(accountSettingsRepositoryProvider)
            .requestDeletion(_deletionKey!);
        _deletionKey = null;
        ref.invalidate(deletionRequestsProvider);
        if (context.mounted)
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Request saved. Re-authentication is required.'),
            ),
          );
      } catch (error) {
        if (context.mounted)
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Deletion request failed: $error')),
          );
      } finally {
        if (mounted) setState(() => _deleting = false);
      }
    }
  }

  Future<void> _downloadExport(
    BuildContext context,
    Map<String, dynamic> request,
  ) async {
    final requestId = request['id'] as String;
    setState(() => _downloadingRequestId = requestId);
    Directory? output;
    try {
      final repository = ref.read(accountSettingsRepositoryProvider);
      final manifest = await repository.exportManifest(
        request['downloadUrl'] as String,
      );
      final chunks = (manifest['chunks'] as List? ?? const [])
          .cast<Map<String, dynamic>>();
      if (chunks.isEmpty) throw StateError('The export contains no files');
      final base = await getApplicationDocumentsDirectory();
      output = Directory('${base.path}/Aividgen-export-$requestId');
      if (await output.exists()) await output.delete(recursive: true);
      await output.create(recursive: true);
      final files = <XFile>[];
      for (var index = 0; index < chunks.length; index++) {
        final key = chunks[index]['key'] as String;
        final url = await repository.exportChunkUrl(requestId, key);
        final file = File('${output.path}/part-${index + 1}.json');
        await repository.downloadSignedFile(url, file.path);
        files.add(XFile(file.path, mimeType: 'application/json'));
      }
      final manifestFile = File('${output.path}/manifest.json');
      await manifestFile.writeAsString(jsonEncode(manifest), flush: true);
      files.insert(0, XFile(manifestFile.path, mimeType: 'application/json'));
      await Share.shareXFiles(
        files,
        text: 'Your Aividgen data export ($requestId)',
      );
    } catch (error) {
      if (output != null && await output.exists()) {
        await output.delete(recursive: true);
      }
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Export download failed: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _downloadingRequestId = null);
    }
  }

  Future<void> _confirm(BuildContext context, WidgetRef ref, String id) async {
    try {
      await ref.read(accountSettingsRepositoryProvider).confirmDeletion(id);
      ref.invalidate(deletionRequestsProvider);
    } catch (error) {
      if (context.mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Confirmation failed: $error')));
    }
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref, String id) async {
    try {
      await ref.read(accountSettingsRepositoryProvider).cancelDeletion(id);
      ref.invalidate(deletionRequestsProvider);
    } catch (error) {
      if (context.mounted)
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Cancellation failed: $error')));
    }
  }
}
