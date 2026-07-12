import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/editor_providers.dart';
import '../tabs/brand_tab.dart';
import '../tabs/captions_tab.dart';
import '../tabs/images_tab.dart';
import '../tabs/music_tab.dart';
import '../tabs/script_tab.dart';
import '../tabs/voice_tab.dart';

/// Tabbed editor for a generated project: Script, Images, Voice, Captions,
/// Music, Brand. Autosaves the composition via [CompositionController].
class EditorScreen extends ConsumerStatefulWidget {
  const EditorScreen({super.key, required this.projectId});

  final String projectId;

  @override
  ConsumerState<EditorScreen> createState() => _EditorScreenState();
}

class _EditorScreenState extends ConsumerState<EditorScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 6, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final compositionAsync = ref.watch(
      compositionControllerProvider(widget.projectId),
    );
    final controller = ref.read(
      compositionControllerProvider(widget.projectId).notifier,
    );

    return Scaffold(
      appBar: AppBar(
        title: const Text('Edit video'),
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabs: const [
            Tab(text: 'Script'),
            Tab(text: 'Images'),
            Tab(text: 'Voice'),
            Tab(text: 'Captions'),
            Tab(text: 'Music'),
            Tab(text: 'Brand'),
          ],
        ),
        actions: [
          _AutosaveIndicator(controller: controller),
          const SizedBox(width: 8),
        ],
      ),
      body: compositionAsync.when(
        data: (composition) => TabBarView(
          controller: _tabController,
          children: [
            ScriptTab(projectId: widget.projectId),
            ImagesTab(projectId: widget.projectId),
            VoiceTab(projectId: widget.projectId),
            CaptionsTab(projectId: widget.projectId),
            MusicTab(projectId: widget.projectId),
            BrandTab(projectId: widget.projectId),
          ],
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                'Could not load project\n$error',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () => ref.invalidate(
                  compositionControllerProvider(widget.projectId),
                ),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: FilledButton.icon(
            onPressed: () async {
              try {
                await controller.saveNow();
                if (context.mounted) {
                  context.push('/render/${widget.projectId}');
                }
              } catch (_) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text(
                        'Could not save your latest edits. Please try again.',
                      ),
                    ),
                  );
                }
              }
            },
            icon: const Icon(Icons.movie_creation_outlined),
            label: const Text('Continue to render'),
          ),
        ),
      ),
    );
  }
}

class _AutosaveIndicator extends StatelessWidget {
  const _AutosaveIndicator({required this.controller});

  final CompositionController controller;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<AutosaveStatus>(
      stream: controller.autosaveStatusStream,
      builder: (context, snapshot) {
        final status = snapshot.data ?? AutosaveStatus.idle;
        final (icon, label) = switch (status) {
          AutosaveStatus.saving => (Icons.cloud_upload_outlined, 'Saving...'),
          AutosaveStatus.saved => (Icons.cloud_done_outlined, 'Saved'),
          AutosaveStatus.error => (Icons.cloud_off_outlined, 'Save failed'),
          AutosaveStatus.idle => (Icons.cloud_outlined, ''),
        };
        if (label.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 16),
              const SizedBox(width: 4),
              Text(label, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        );
      },
    );
  }
}
