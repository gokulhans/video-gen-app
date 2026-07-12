import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';
import '../../../core/models/character_voice.dart';
import '../../../design_system/components/app_page.dart';
import '../../../design_system/components/empty_state.dart';
import '../../../design_system/components/error_state.dart';
import '../../../design_system/components/media_preview_tile.dart';
import '../../../design_system/components/section_card.dart';
import '../../../design_system/components/status_badge.dart';
import '../../../design_system/tokens/app_spacing.dart';
import '../providers/character_providers.dart';

class CharacterScreen extends ConsumerWidget {
  const CharacterScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hub = ref.watch(characterHubProvider);
    return AppPage(
      child: RefreshIndicator(
        onRefresh: () => ref.read(characterHubProvider.notifier).refresh(),
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xl)),
            SliverToBoxAdapter(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Your on-screen team',
                          style: Theme.of(context).textTheme.headlineMedium,
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Build trusted presenters and voices once, then keep every campaign consistent.',
                          style: Theme.of(context).textTheme.bodyLarge
                              ?.copyWith(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  IconButton(
                    tooltip: 'Refresh team',
                    onPressed: () =>
                        ref.read(characterHubProvider.notifier).refresh(),
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                ],
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xl)),
            ...hub.when(
              loading: () => [
                SliverToBoxAdapter(
                  child: SectionCard(
                    child: Semantics(
                      label: 'Loading presenters and voices',
                      child: const Text('Loading your team…'),
                    ),
                  ),
                ),
              ],
              error: (_, _) => [
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: ErrorState(
                    message:
                        'Your presenter and voice library could not be loaded.',
                    onRetry: () =>
                        ref.read(characterHubProvider.notifier).refresh(),
                  ),
                ),
              ],
              data: (data) => [SliverToBoxAdapter(child: _Hub(data: data))],
            ),
            const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xxl)),
          ],
        ),
      ),
    );
  }
}

class _Hub extends ConsumerWidget {
  const _Hub({required this.data});
  final CharacterHubState data;
  @override
  Widget build(BuildContext context, WidgetRef ref) => LayoutBuilder(
    builder: (context, constraints) {
      final wide = constraints.maxWidth >= 820;
      final presenters = Column(
        children: [
          _MinePanel(
            items: data.mine,
            onCreate: () => _showCreate(context, ref),
          ),
          const SizedBox(height: AppSpacing.md),
          _StockPanel(items: data.stock),
        ],
      );
      final voices = _VoicePanel(
        items: data.voices,
        onFavorite: (voice) =>
            ref.read(characterHubProvider.notifier).toggleFavorite(voice),
      );
      return Column(
        children: [
          if (data.mutationError != null) ...[
            MaterialBanner(
              content: Text(data.mutationError!),
              actions: [
                TextButton(
                  onPressed: () =>
                      ref.read(characterHubProvider.notifier).refresh(),
                  child: const Text('Refresh'),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          if (wide)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(flex: 3, child: presenters),
                const SizedBox(width: AppSpacing.lg),
                Expanded(flex: 2, child: voices),
              ],
            )
          else ...[
            presenters,
            const SizedBox(height: AppSpacing.md),
            voices,
          ],
        ],
      );
    },
  );

  Future<void> _showCreate(BuildContext context, WidgetRef ref) async {
    await showDialog<void>(
      context: context,
      builder: (_) => const _CreatePresenterDialog(),
    );
  }
}

class _MinePanel extends ConsumerWidget {
  const _MinePanel({required this.items, required this.onCreate});
  final List<UserCharacter> items;
  final VoidCallback onCreate;
  @override
  Widget build(BuildContext context, WidgetRef ref) => SectionCard(
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
                    'Your presenters',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    'Private identities created from images you own.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            FilledButton.icon(
              onPressed: onCreate,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Create'),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        if (items.isEmpty)
          const EmptyState(
            icon: Icons.person_add_alt_1_outlined,
            title: 'No presenters yet',
            message:
                'Create one from a finalized image. It will stay pending until review is complete.',
          )
        else
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              for (final item in items)
                SizedBox(width: 230, child: _UserCard(item: item)),
            ],
          ),
      ],
    ),
  );
}

class _UserCard extends ConsumerWidget {
  const _UserCard({required this.item});
  final UserCharacter item;
  @override
  Widget build(BuildContext context, WidgetRef ref) => SectionCard(
    padding: EdgeInsets.zero,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(height: 128, child: _PresenterImage(url: item.previewUrl)),
        Padding(
          padding: const EdgeInsets.all(AppSpacing.sm),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                item.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: AppSpacing.xs),
              StatusBadge(
                label: _label(item.status),
                status: _status(item.status),
              ),
              if (item.status == UserCharacterStatus.pendingReview) ...[
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Pending staff review. Not available for generation until an authorized reviewer approves it.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
              if (item.status == UserCharacterStatus.rejected &&
                  item.rejectionReason != null) ...[
                const SizedBox(height: AppSpacing.xs),
                Text(
                  item.rejectionReason!,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.error,
                  ),
                ),
              ],
              Align(
                alignment: Alignment.centerRight,
                child: PopupMenuButton<String>(
                  tooltip: 'Presenter actions',
                  onSelected: (action) => _action(context, ref, action),
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'archive', child: Text('Archive')),
                    PopupMenuItem(
                      value: 'delete',
                      child: Text('Delete permanently'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
  Future<void> _action(
    BuildContext context,
    WidgetRef ref,
    String action,
  ) async {
    final destructive = action == 'delete';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(destructive ? 'Delete presenter?' : 'Archive presenter?'),
        content: Text(
          destructive
              ? 'This permanently removes the presenter when it is not used by a generation.'
              : 'This removes the presenter from your active team without deleting past generations.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(destructive ? 'Delete' : 'Archive'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final controller = ref.read(characterHubProvider.notifier);
    destructive
        ? await controller.delete(item)
        : await controller.archive(item);
  }

  static String _label(UserCharacterStatus value) => switch (value) {
    UserCharacterStatus.pendingReview => 'Pending review',
    UserCharacterStatus.processing => 'Processing',
    UserCharacterStatus.ready => 'Ready',
    UserCharacterStatus.rejected => 'Needs attention',
    UserCharacterStatus.archived => 'Archived',
  };
  static AppStatus _status(UserCharacterStatus value) => switch (value) {
    UserCharacterStatus.ready => AppStatus.success,
    UserCharacterStatus.rejected => AppStatus.error,
    UserCharacterStatus.pendingReview ||
    UserCharacterStatus.processing => AppStatus.warning,
    UserCharacterStatus.archived => AppStatus.neutral,
  };
}

class _StockPanel extends StatelessWidget {
  const _StockPanel({required this.items});
  final List<StockCharacter> items;
  @override
  Widget build(BuildContext context) => SectionCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Verified presenters',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: AppSpacing.xxs),
        Text(
          'Active, licensed presenters approved for generation.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        if (items.isEmpty)
          const EmptyState(
            icon: Icons.verified_user_outlined,
            title: 'No verified presenters',
            message:
                'The studio team has not published any licensed presenters yet.',
          )
        else
          SizedBox(
            height: 210,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.sm),
              itemBuilder: (_, index) => SizedBox(
                width: 150,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: _PresenterImage(url: items[index].previewUrl),
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      items[index].name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    Text(
                      items[index].tags.take(2).join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

class _VoicePanel extends StatefulWidget {
  const _VoicePanel({required this.items, required this.onFavorite});
  final List<VoiceProfile> items;
  final ValueChanged<VoiceProfile> onFavorite;
  @override
  State<_VoicePanel> createState() => _VoicePanelState();
}

class _VoicePanelState extends State<_VoicePanel> {
  final AudioPlayer _player = AudioPlayer();
  String? _playingId;
  StreamSubscription<PlayerState>? _playerStateSubscription;

  @override
  void initState() {
    super.initState();
    _playerStateSubscription = _player.playerStateStream.listen((state) {
      if (state.processingState == ProcessingState.completed && mounted) {
        setState(() => _playingId = null);
      }
    });
  }

  @override
  void dispose() {
    _playerStateSubscription?.cancel();
    _player.dispose();
    super.dispose();
  }

  Future<void> _toggle(VoiceProfile voice) async {
    if (voice.sampleUrl == null) return;
    try {
      if (_playingId == voice.id) {
        await _player.pause();
        if (mounted) setState(() => _playingId = null);
        return;
      }
      await _player.stop();
      await _player.setUrl(voice.sampleUrl!);
      if (!mounted) return;
      setState(() => _playingId = voice.id);
      unawaited(_player.play());
    } catch (_) {
      if (!mounted) return;
      setState(() => _playingId = null);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Voice sample could not be played.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) => SectionCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Voice library', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: AppSpacing.xxs),
        Text(
          'Favorite narration styles you want close at hand.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        if (widget.items.isEmpty)
          const EmptyState(
            icon: Icons.graphic_eq_rounded,
            title: 'No active voices',
            message: 'Approved narration voices will appear here.',
          )
        else
          for (final voice
              in [...widget.items]..sort(
                (a, b) => a.isFavorite == b.isFavorite
                    ? a.name.compareTo(b.name)
                    : a.isFavorite
                    ? -1
                    : 1,
              ))
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Semantics(
                container: true,
                label:
                    '${voice.name}, ${voice.locale}${voice.isPremium ? ', premium' : ''}',
                child: SectionCard(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 56,
                        height: 48,
                        child: IconButton(
                          tooltip: voice.sampleUrl == null
                              ? 'No sample available for ${voice.name}'
                              : _playingId == voice.id
                              ? 'Pause ${voice.name} sample'
                              : 'Play ${voice.name} sample',
                          onPressed: voice.sampleUrl == null
                              ? null
                              : () => _toggle(voice),
                          icon: Icon(
                            _playingId == voice.id
                                ? Icons.pause_circle_filled_rounded
                                : Icons.play_circle_fill_rounded,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              voice.name,
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                            Text(
                              [
                                voice.locale,
                                if (voice.style != null) voice.style!,
                                if (voice.isPremium) 'Premium',
                              ].join(' · '),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        tooltip: voice.isFavorite
                            ? 'Remove ${voice.name} from favorites'
                            : 'Favorite ${voice.name}',
                        onPressed: () => widget.onFavorite(voice),
                        icon: Icon(
                          voice.isFavorite
                              ? Icons.favorite_rounded
                              : Icons.favorite_border_rounded,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
      ],
    ),
  );
}

class _PresenterImage extends StatelessWidget {
  const _PresenterImage({this.url});
  final String? url;

  @override
  Widget build(BuildContext context) {
    const fallback = MediaPreviewTile(kind: MediaPreviewKind.presenter);
    if (url == null || url!.isEmpty) return fallback;
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: CachedNetworkImage(
        imageUrl: url!,
        fit: BoxFit.cover,
        placeholder: (_, _) => fallback,
        errorWidget: (_, _, _) => fallback,
      ),
    );
  }
}

class _CreatePresenterDialog extends ConsumerStatefulWidget {
  const _CreatePresenterDialog();
  @override
  ConsumerState<_CreatePresenterDialog> createState() =>
      _CreatePresenterDialogState();
}

class _CreatePresenterDialogState
    extends ConsumerState<_CreatePresenterDialog> {
  final _name = TextEditingController();
  List<int>? _bytes;
  String? _fileName;
  String? _contentType;
  bool _consent = false;
  bool _busy = false;
  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Create presenter'),
    content: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 480),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Your image is uploaded privately and sent to authorized staff for manual consent and safety review.',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: _name,
              maxLength: 100,
              decoration: const InputDecoration(labelText: 'Presenter name *'),
            ),
            OutlinedButton.icon(
              onPressed: _busy ? null : _pick,
              icon: const Icon(Icons.add_photo_alternate_outlined),
              label: Text(_fileName ?? 'Choose image *'),
            ),
            const SizedBox(height: AppSpacing.sm),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _consent,
              onChanged: _busy
                  ? null
                  : (value) => setState(() => _consent = value == true),
              title: const Text(
                'I own this image or have explicit permission to create an AI presenter from it.',
              ),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            const SizedBox(height: AppSpacing.xs),
            const StatusBadge(
              label: 'New presenters start pending staff review',
              status: AppStatus.warning,
              icon: Icons.shield_outlined,
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: _busy ? null : () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: _busy ? null : _submit,
        child: Text(_busy ? 'Submitting' : 'Submit for review'),
      ),
    ],
  );
  Future<void> _pick() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp'],
      allowMultiple: false,
      withData: true,
    );
    final file = result?.files.singleOrNull;
    if (file?.bytes == null) return;
    if (file!.bytes!.length > 10000000) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Choose an image smaller than 10 MB.')),
        );
      }
      return;
    }
    setState(() {
      _bytes = file.bytes;
      _fileName = file.name;
      _contentType = switch (file.extension?.toLowerCase()) {
        'png' => 'image/png',
        'webp' => 'image/webp',
        _ => 'image/jpeg',
      };
    });
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.isEmpty || _bytes == null || !_consent) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Add a name and image, then confirm consent.'),
        ),
      );
      return;
    }
    setState(() => _busy = true);
    final ok = await ref
        .read(characterHubProvider.notifier)
        .create(
          name: name,
          bytes: _bytes!,
          contentType: _contentType!,
          consentStatement:
              'I own this image or have explicit permission to create an AI presenter from it.',
        );
    if (mounted) {
      setState(() => _busy = false);
      if (ok) Navigator.pop(context);
    }
  }
}
