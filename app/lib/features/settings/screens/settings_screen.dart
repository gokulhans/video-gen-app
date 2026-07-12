import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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

class _NotificationSettings extends ConsumerWidget {
  const _NotificationSettings({required this.value});
  final AsyncValue<NotificationPreferences> value;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Card(
    child: Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: value.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Text('$error'),
        data: (prefs) => Column(
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
              (value) => _save(ref, prefs.copyWith(pushEnabled: value)),
            ),
            _tile(
              'Transactional email',
              prefs.emailEnabled,
              (value) => _save(ref, prefs.copyWith(emailEnabled: value)),
            ),
            _tile(
              'Generation updates',
              prefs.generationUpdates,
              (value) => _save(ref, prefs.copyWith(generationUpdates: value)),
            ),
            _tile(
              'Render updates',
              prefs.renderUpdates,
              (value) => _save(ref, prefs.copyWith(renderUpdates: value)),
            ),
            const Text(
              'Email is used only for opted-in generation, render, and account lifecycle updates.',
            ),
          ],
        ),
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
  Future<void> _save(WidgetRef ref, NotificationPreferences value) async {
    await ref.read(accountSettingsRepositoryProvider).save(value);
    ref.invalidate(settingsPreferencesProvider);
  }
}

class _PrivacySettings extends ConsumerWidget {
  const _PrivacySettings({required this.value});
  final AsyncValue<Map<String, dynamic>> value;
  @override
  Widget build(BuildContext context, WidgetRef ref) => Card(
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
          value.when(
            loading: () => const LinearProgressIndicator(),
            error: (error, _) => Text('$error'),
            data: (summary) => Text(
              '${summary['characterConsentRecords'] ?? 0} immutable presenter consent record(s). Marketing is opt-in.',
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          OutlinedButton.icon(
            onPressed: () => _export(context, ref),
            icon: const Icon(Icons.download_outlined),
            label: const Text('Request my data export'),
          ),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton.icon(
            onPressed: () => _delete(context, ref),
            icon: const Icon(Icons.person_remove_outlined),
            label: const Text('Request account deletion'),
          ),
        ],
      ),
    ),
  );
  Future<void> _export(BuildContext context, WidgetRef ref) async {
    try {
      final result = await ref
          .read(accountSettingsRepositoryProvider)
          .requestExport();
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
      try {
        await ref.read(accountSettingsRepositoryProvider).requestDeletion();
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
      }
    }
  }
}
