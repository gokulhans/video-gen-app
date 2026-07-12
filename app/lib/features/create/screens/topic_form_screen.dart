import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/create_providers.dart';
import '../widgets/voice_picker.dart';

const _languages = [
  ('en', 'English'),
  ('es', 'Spanish'),
  ('fr', 'French'),
  ('pt', 'Portuguese'),
  ('hi', 'Hindi'),
  ('ar', 'Arabic'),
];

class TopicFormScreen extends ConsumerStatefulWidget {
  const TopicFormScreen({super.key});

  @override
  ConsumerState<TopicFormScreen> createState() => _TopicFormScreenState();
}

class _TopicFormScreenState extends ConsumerState<TopicFormScreen> {
  late final TextEditingController _topicController;
  late final TextEditingController _detailsController;

  @override
  void initState() {
    super.initState();
    final form = ref.read(createFormProvider);
    _topicController = TextEditingController(text: form.topic);
    _detailsController = TextEditingController(text: form.details);
  }

  @override
  void dispose() {
    _topicController.dispose();
    _detailsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final form = ref.watch(createFormProvider);
    final formNotifier = ref.read(createFormProvider.notifier);
    final voicesAsync = ref.watch(voicesProvider(form.language));
    final costAsync = ref.watch(generationCostEstimateProvider);
    final launchState = ref.watch(generationLaunchControllerProvider);

    ref.listen(generationLaunchControllerProvider, (previous, next) {
      if (next.status == GenerationLaunchStatus.error &&
          next.errorMessage != null) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(next.errorMessage!)));
      }
    });

    if (form.template == null) {
      // Guard against deep-linking directly into this screen.
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => context.go('/create/templates'),
      );
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(title: Text(form.template!.name)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Text(
            'What is this video about?',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _topicController,
            decoration: const InputDecoration(
              hintText: 'e.g. Grand opening of our new downtown café',
            ),
            maxLines: 2,
            onChanged: (value) => formNotifier.update(topic: value),
          ),
          const SizedBox(height: 16),
          Text(
            'Extra details (optional)',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _detailsController,
            decoration: const InputDecoration(
              hintText: 'Promotions, tone, key selling points...',
            ),
            maxLines: 3,
            onChanged: (value) => formNotifier.update(details: value),
          ),
          const SizedBox(height: 20),
          Text('Language', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: form.language,
            items: _languages
                .map((l) => DropdownMenuItem(value: l.$1, child: Text(l.$2)))
                .toList(),
            onChanged: (value) {
              if (value != null) formNotifier.update(language: value);
            },
          ),
          const SizedBox(height: 20),
          Text(
            'Duration: ${form.durationSec}s',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          Slider(
            value: form.durationSec.toDouble(),
            min: 15,
            max: 90,
            divisions: 15,
            label: '${form.durationSec}s',
            onChanged: (value) =>
                formNotifier.update(durationSec: value.round()),
          ),
          const SizedBox(height: 12),
          Text('Voice', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          voicesAsync.when(
            data: (voices) => VoicePicker(
              voices: voices,
              selectedId: form.voice,
              onSelected: (id) => formNotifier.update(voice: id),
            ),
            loading: () => const SizedBox(
              height: 96,
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (_, __) => const Text('Could not load voices'),
          ),
          const SizedBox(height: 24),
          _CostEstimateCard(costAsync: costAsync),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: launchState.status == GenerationLaunchStatus.loading
                ? null
                : () async {
                    final project = await ref
                        .read(generationLaunchControllerProvider.notifier)
                        .launch();
                    if (project != null && context.mounted) {
                      context.go('/create/progress/${project.id}');
                    }
                  },
            icon: launchState.status == GenerationLaunchStatus.loading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.auto_awesome),
            label: const Text('Generate video'),
          ),
        ],
      ),
    );
  }
}

class _CostEstimateCard extends StatelessWidget {
  const _CostEstimateCard({required this.costAsync});

  final AsyncValue costAsync;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: costAsync.when(
          data: (estimate) => Row(
            children: [
              const Icon(Icons.toll_outlined),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Estimated cost: ${estimate.total} tokens',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    if (estimate.breakdown.isNotEmpty)
                      Text(
                        estimate.breakdown.entries
                            .map((e) => '${e.key}: ${e.value}')
                            .join(' · '),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                  ],
                ),
              ),
            ],
          ),
          loading: () => const Row(
            children: [
              SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              SizedBox(width: 12),
              Text('Estimating cost...'),
            ],
          ),
          error: (_, __) => const Text('Could not estimate cost'),
        ),
      ),
    );
  }
}
