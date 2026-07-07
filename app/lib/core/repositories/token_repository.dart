import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../models/token_balance.dart';

/// Tokens: balance/history/cost-estimate/purchase-verify (CONTRACTS.md).
class TokenRepository {
  TokenRepository(this._api);

  final ApiClient _api;

  Future<TokenBalance> getBalance() {
    return _api.get<TokenBalance>(
      '/tokens/balance',
      parser: (json) => TokenBalance.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<List<TokenTransaction>> getHistory({int limit = 50, int offset = 0}) {
    return _api.get<List<TokenTransaction>>(
      '/tokens/history',
      query: {'limit': limit, 'offset': offset},
      parser: (json) => (json as List<dynamic>)
          .map((e) => TokenTransaction.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<CostEstimate> getCostEstimate({
    required String templateId,
    required int durationSec,
  }) {
    return _api.get<CostEstimate>(
      '/tokens/cost-estimate',
      query: {'templateId': templateId, 'duration': durationSec},
      parser: (json) => CostEstimate.fromJson(json as Map<String, dynamic>),
    );
  }

  Future<CostEstimate> getActionCostEstimate(String action) {
    return _api.get<CostEstimate>(
      '/tokens/cost-estimate',
      query: {'action': action},
      parser: (json) => CostEstimate.fromJson(json as Map<String, dynamic>),
    );
  }

  /// Sends a Google Play Billing purchase token/receipt for server-side
  /// verification. See lib/features/tokens/screens/purchase_screen.dart for
  /// the in_app_purchase wiring (TODO: real product ids + billing flow).
  Future<TokenBalance> verifyPurchase({
    required String productId,
    required String purchaseToken,
  }) {
    return _api.post<TokenBalance>(
      '/tokens/purchase/verify',
      body: {'productId': productId, 'purchaseToken': purchaseToken},
      parser: (json) => TokenBalance.fromJson(json as Map<String, dynamic>),
    );
  }
}

final tokenRepositoryProvider = Provider<TokenRepository>((ref) {
  return TokenRepository(ref.watch(apiClientProvider));
});

final tokenBalanceProvider = FutureProvider.autoDispose<TokenBalance>((ref) async {
  final repo = ref.watch(tokenRepositoryProvider);
  return repo.getBalance();
});
