import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/repositories/token_repository.dart';
import '../providers/token_providers.dart';

/// Balance + transaction history screen.
class TokenBalanceScreen extends ConsumerWidget {
  const TokenBalanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final balanceAsync = ref.watch(tokenBalanceProvider);
    final historyAsync = ref.watch(tokenHistoryProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Tokens')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(tokenBalanceProvider);
          ref.invalidate(tokenHistoryProvider);
          await ref.read(tokenBalanceProvider.future);
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              color: Theme.of(context).colorScheme.primaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    Text(
                      'Balance',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    balanceAsync.when(
                      data: (balance) => Text(
                        '${balance.tokens}',
                        style: Theme.of(context).textTheme.displaySmall,
                      ),
                      loading: () => const CircularProgressIndicator(),
                      error: (_, __) => const Text('--'),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: () => context.push('/tokens/purchase'),
                      icon: const Icon(Icons.add),
                      label: const Text('Buy more tokens'),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text('History', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            historyAsync.when(
              data: (transactions) {
                if (transactions.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: Text('No transactions yet')),
                  );
                }
                return Column(
                  children: transactions
                      .map(
                        (t) => ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            t.amount >= 0
                                ? Icons.add_circle_outline
                                : Icons.remove_circle_outline,
                            color: t.amount >= 0 ? Colors.green : Colors.red,
                          ),
                          title: Text(t.description),
                          subtitle: Text(
                            DateFormat.yMMMd().add_jm().format(t.createdAt),
                          ),
                          trailing: Text(
                            '${t.amount >= 0 ? '+' : ''}${t.amount}',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: t.amount >= 0 ? Colors.green : Colors.red,
                            ),
                          ),
                        ),
                      )
                      .toList(),
                );
              },
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, _) => Text('$error'),
            ),
          ],
        ),
      ),
    );
  }
}
